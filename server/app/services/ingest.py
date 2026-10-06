from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.models import ResultStatus, Sensor, Test, TestResult
from app.schemas import IngestResult


def ingest_results(
    db: Session, sensor: Sensor, results: list[IngestResult]
) -> tuple[int, int, list[str]]:
    accepted = 0
    duplicates = 0
    ids: list[str] = []

    tests = (
        db.query(Test)
        .options(joinedload(Test.network))
        .filter(Test.sensor_id == sensor.id)
        .all()
    )
    test_map: dict[tuple[str, str], Test] = {(t.network.slug, t.slug): t for t in tests}

    for item in results:
        existing = db.query(TestResult).filter(TestResult.external_id == item.id).first()
        if existing:
            duplicates += 1
            ids.append(item.id)
            continue

        test = test_map.get((item.network_slug, item.test_slug))
        if test is None:
            continue

        try:
            status = ResultStatus(item.status)
        except ValueError:
            continue

        row = TestResult(
            external_id=item.id,
            test_id=test.id,
            started_at=item.started_at,
            finished_at=item.finished_at,
            status=status,
            stages=[s.model_dump() for s in item.stages],
            metrics=item.metrics,
            message=item.message,
        )
        db.add(row)
        accepted += 1
        ids.append(item.id)

    db.flush()
    return accepted, duplicates, ids
