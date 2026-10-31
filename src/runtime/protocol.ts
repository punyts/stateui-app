export { isIconsMap } from './icons.js';
export * from './limits.js';
export { FILE_ERROR_CODES, INBOUND_TYPES, MESSAGE_TYPES, OUTBOUND_TYPES, PROTOCOL_VERSION } from './messages.js';
export type {
    CommandMessage,
    EmitMessage,
    ErrorMessage,
    FileCancelMessage,
    FileErrorCode,
    FileMessage,
    FileProgressMessage,
    FileReference,
    FileResultMessage,
    IconData,
    IconPathData,
    IconsMap,
    InboundMessage,
    InboundType,
    LoadMessage,
    LocaleMessage,
    MessageType,
    OutboundMessage,
    OutboundType,
    PathWrite,
    PingMessage,
    PongMessage,
    ProtocolError,
    ReadyMessage,
    RuntimeMessage,
    SnapshotMessage,
    StateSnapshotData,
    ThemeMessage,
    WriteMessage
} from './messages.js';
export { isWritablePath, validateMessage } from './validate.js';
export type { DropReason, ValidationResult } from './validate.js';
