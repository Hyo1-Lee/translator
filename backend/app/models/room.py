"""
Room 관련 데이터 모델
"""
from typing import Set, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class RoomStatus(str, Enum):
    """방 상태"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    CLOSING = "closing"


class Room(BaseModel):
    """방 정보 모델"""
    room_id: str = Field(..., description="방 고유 ID")
    speaker_sid: str = Field(..., description="스피커 세션 ID")
    speaker_name: str = Field(default="Speaker", description="스피커 이름")
    listeners: Set[str] = Field(default_factory=set, description="리스너 세션 ID 집합")
    status: RoomStatus = Field(default=RoomStatus.ACTIVE, description="방 상태")
    created_at: datetime = Field(default_factory=datetime.now, description="생성 시간")

    # STT 관련
    stt_client: Optional[Any] = Field(default=None, exclude=True, description="STT 클라이언트")
    transcript_buffer: Optional[Any] = Field(default=None, exclude=True, description="텍스트 버퍼")
    thread: Optional[Any] = Field(default=None, exclude=True, description="WebSocket 스레드")

    class Config:
        arbitrary_types_allowed = True


class CreateRoomRequest(BaseModel):
    """방 생성 요청 모델"""
    name: str = Field(default="Speaker", description="스피커 이름")


class CreateRoomResponse(BaseModel):
    """방 생성 응답 모델"""
    room_id: str = Field(..., description="생성된 방 ID")
    status: str = Field(default="created", description="상태")


class JoinRoomRequest(BaseModel):
    """방 참가 요청 모델"""
    room_id: str = Field(..., description="참가할 방 ID")


class JoinRoomResponse(BaseModel):
    """방 참가 응답 모델"""
    room_id: str = Field(..., description="참가한 방 ID")
    speaker_name: str = Field(..., description="스피커 이름")
    status: str = Field(default="joined", description="상태")


class RoomStatusResponse(BaseModel):
    """방 상태 응답 모델"""
    room_id: str
    speaker_name: str
    listener_count: int
    status: RoomStatus
    created_at: datetime