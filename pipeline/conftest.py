"""pytest 配置：在受限沙箱中确保有可用临时目录（tmp_path fixture 依赖）。

若系统默认临时目录不可写（沙箱），把 TMPDIR 指到仓库内 .pytest_tmp/。
正常环境无副作用。
"""

import os
import tempfile

_LOCAL_TMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".pytest_tmp")


def _tmp_ok() -> bool:
    try:
        with tempfile.TemporaryFile():
            return True
    except OSError:
        return False


if not _tmp_ok():
    os.makedirs(_LOCAL_TMP, exist_ok=True)
    os.environ["TMPDIR"] = os.path.abspath(_LOCAL_TMP)
    tempfile.tempdir = os.path.abspath(_LOCAL_TMP)
