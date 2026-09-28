"""Project-wide immutable model attempts and restart-resistant stage budgets."""
import hashlib
import json
from pathlib import Path
import sqlite3
import time
import uuid
from stage_runtime import atomic_write_json, atomic_write_text


def model_request(project, stage, prompt, model_fn, *, scope='', limit=None, budget=None, token=None, **kwargs):
    if budget is not None:
        from request_journal import invoke
        return invoke(budget, token, prompt, model_fn, context={'kind':'workflow','phase':stage},
                      preserve_result=True, **kwargs)
    reports = Path(project) / 'reports'
    reports.mkdir(parents=True, exist_ok=True)
    request_id = uuid.uuid4().hex
    record = {'id': request_id, 'stage': stage, 'scope': scope, 'status': 'in_flight',
              'started': time.time(), 'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest()}
    with sqlite3.connect(reports / 'workflow_calls.sqlite', timeout=30) as db:
        db.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, stage TEXT, scope TEXT, started REAL)')
        db.execute('BEGIN IMMEDIATE')
        used = db.execute('SELECT count(*) FROM requests WHERE stage=? AND scope=?', (stage, scope)).fetchone()[0]
        if limit is not None and used >= limit:
            raise RuntimeError(f'{stage}_budget_exhausted: {used}/{limit}; inspect saved responses, not --force')
        db.execute('INSERT INTO requests VALUES (?,?,?,?)', (request_id, stage, scope, record['started']))
    directory = reports / 'requests'
    atomic_write_json(directory / (request_id + '.json'), record)
    try:
        result = model_fn(prompt, **kwargs)
        raw = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        atomic_write_text(directory / (request_id + '.txt'), raw)
        record.update(status='completed', output_sha256=hashlib.sha256(raw.encode()).hexdigest())
        from sol_common import response_metadata
        record.update(response_metadata(result))
        return result
    except Exception as exc:
        record.update(status='failed', error_type=type(exc).__name__)
        raise
    finally:
        record['finished'] = time.time()
        record['latency_s'] = round(record['finished']-record['started'], 3)
        atomic_write_json(directory / (request_id + '.json'), record)


def planning_scope(root, topic, pages, brief):
    # Prompt wording, worker count and --force never reset the input budget.
    value = {'topic': topic, 'pages': pages, 'brief': brief}
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def project_summary(project):
    reports = Path(project) / 'reports'
    attempts = [json.loads(p.read_text()) for p in (reports / 'requests').glob('*.json')]
    render_attempts = [dict(json.loads(p.read_text()), id='attempt:' + p.stem)
                       for p in (reports / 'request_journal').glob('*.json') if p.stem.isdigit()]
    # Canonical attempt identities deduplicate phase-specific companion receipts.
    by_attempt = {r['attempt_id']:r for r in render_attempts}
    all_receipts = [r for r in attempts if r.get('attempt_id') not in by_attempt] + render_attempts
    not_submitted=sum(r.get('status')=='not_submitted' for r in all_receipts)
    usage_receipts=[r for r in all_receipts if r.get('status')!='not_submitted']
    missing_receipts = []
    ledger = reports/'execution_budget.sqlite'
    if ledger.exists():
        with sqlite3.connect('file:'+str(ledger)+'?mode=ro',uri=True) as db:
            for token,stage,status in db.execute('SELECT id,stage,status FROM attempts'):
                # Imported legacy rows cannot be joined exactly to old UUID receipts;
                # leave coverage explicitly unknown instead of guessing correspondence.
                if token not in by_attempt and not any(r.get('attempt_id')==token for r in attempts):
                    missing_receipts.append({'attempt_id':token,'stage':stage,'status':status})
    usage_records = [{'id': r['id'], 'stage': r['stage'], 'usage': r['provider_usage'],
                      'model': r.get('model'), 'finish_reason': r.get('finish_reason')}
                     for r in usage_receipts if r.get('provider_usage')]
    totals = {}
    for key in ('prompt_tokens', 'completion_tokens', 'total_tokens'):
        values = [r['usage'][key] for r in usage_records
                  if isinstance(r['usage'].get(key), (int, float)) and not isinstance(r['usage'][key], bool)]
        totals[key] = sum(values) if values else None
    cache_values = [r['usage']['prompt_tokens_details'].get('cached_tokens') for r in usage_records
                    if isinstance(r['usage'].get('prompt_tokens_details'), dict)]
    cache_values = [v for v in cache_values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    totals['cached_input_tokens'] = sum(cache_values) if cache_values else None
    coverage = {'records_with_usage': len(usage_records),
                'records_without_usage': len(usage_receipts) - len(usage_records) + len(missing_receipts),
                'not_submitted':not_submitted,
                'missing_receipts': missing_receipts,
                'complete': bool(usage_receipts) and not missing_receipts and len(usage_records) == len(usage_receipts)
                            and all(isinstance(r['usage'].get('total_tokens'), (int, float))
                                    and not isinstance(r['usage']['total_tokens'], bool)
                                    for r in usage_records),
                'reported_totals': totals,
                'meaning': 'reported subtotal only; unavailable fields are not zero; not a billing estimate'}
    stages = {}
    for a in all_receipts:
        counts = stages.setdefault(a['stage'], {})
        counts[a['status']] = counts.get(a['status'], 0) + 1
    build_reservations = 0
    build_budget = {}
    build_runs = {}
    path = reports / 'call_budget.sqlite'
    if path.exists():
        with sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True) as db:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'calls' in tables:
                build_reservations = db.execute('SELECT count(*) FROM calls').fetchone()[0]
                build_runs = dict(db.execute('SELECT run_id,count(*) FROM calls GROUP BY run_id'))
            if 'policy' in tables:
                row = db.execute('SELECT soft,hard FROM policy WHERE id=1').fetchone()
                if row:
                    build_budget = {'soft_limit': row[0], 'hard_limit': row[1]}
            if 'budget_events' in tables:
                build_budget['events'] = [dict(started=r[0], old_limit=r[1], new_limit=r[2], reason=r[3])
                    for r in db.execute('SELECT started,old_limit,new_limit,reason FROM budget_events ORDER BY started')]
    from work_budget import summary as execution_summary
    durations = {}
    for row in all_receipts:
        if row.get('finished') is not None:
            durations.setdefault(row['stage'], []).append(max(0, row['finished']-row['started']))
    return {'execution_budget': execution_summary(project), 'stages': stages, 'build_request_reservations': build_reservations,
            'observed_request_latency_s':durations,
            'provider_usage_records': usage_records, 'provider_usage_summary': coverage,
            'billing_status':'not_computed; missing provider usage is unknown, not zero',
            'build_budget': build_budget, 'build_reservations_by_run': build_runs,
            'note': 'in_flight after interruption means outcome unknown; reservations are not provider billing'}
