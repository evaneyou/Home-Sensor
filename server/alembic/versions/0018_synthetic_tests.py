"""Add LibreSpeed and video-call test kinds."""

from typing import Sequence, Union

from alembic import op

revision: str = "0018_synthetic_tests"
down_revision: Union[str, None] = "0017_probe_restart"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE test_kind ADD VALUE IF NOT EXISTS 'librespeed'")
    op.execute("ALTER TYPE test_kind ADD VALUE IF NOT EXISTS 'webrtc'")


def downgrade() -> None:
    pass
