export { isIconsMap } from './icons.js';
export * from './limits.js';
export { APP_EVENTS, CHANGE_OPS, FILE_ERROR_CODES, INBOUND_TYPES, MESSAGE_TYPES, OUTBOUND_TYPES, PROTOCOL_VERSION } from './messages.js';
export type {
    AppEventName,
    ChangeMessage,
    ChangeOp,
    CommandMessage,
    EmitMessage,
    ErrorMessage,
    EventMessage,
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
    RuntimeChange,
    RuntimeMessage,
    RuntimeMode,
    StateSnapshotData,
    ThemeMessage,
    WriteMessage
} from './messages.js';
export { isWritablePath, validateMessage } from './validate.js';
export type { DropReason, ValidationResult } from './validate.js';
