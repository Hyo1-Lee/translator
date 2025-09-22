"""
로깅 설정 모듈
"""
import logging
import sys
from typing import Optional
from app.config import settings


def setup_logger(
    name: str,
    level: Optional[str] = None,
    format: Optional[str] = None
) -> logging.Logger:
    """
    로거 설정 및 반환

    Args:
        name: 로거 이름
        level: 로그 레벨 (기본: 설정 파일의 LOG_LEVEL)
        format: 로그 포맷 (기본: 설정 파일의 LOG_FORMAT)

    Returns:
        설정된 로거 인스턴스
    """
    level = level or settings.LOG_LEVEL
    format = format or settings.LOG_FORMAT

    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level))

    # 핸들러가 이미 설정되어 있지 않은 경우에만 추가
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(getattr(logging, level))

        formatter = logging.Formatter(format)
        handler.setFormatter(formatter)

        logger.addHandler(handler)

    return logger


# 기본 로거
logger = setup_logger(__name__)