export { VERSION } from './version.js';
export { ERROR_CATALOG, ERROR_PREFIXES, TEMPLATE_PLACEHOLDERS, buildError, isValid } from './errors/index.js';
export type { BuildError, CatalogEntry, ErrorCode, ErrorDetails, Severity, TemplatePlaceholder } from './errors/index.js';
export { MAX_DATA_BYTES, MAX_DEPTH, MAX_DOCUMENT_BYTES, MAX_NODES, checkLimits } from './limits.js';
export { APP_EVENTS, DOCUMENT_KEYS, PREFIXES, RESERVED_KEYS, RESERVED_KEY_NAMES, isAppEvent } from './types.js';
export type { AppDocument, AppEventName, AppTheme, DocumentScreen, JsonObject, JsonValue, Node, ThemeOverlay, ThemeState } from './types.js';
export {
    COMPONENT_CATEGORIES,
    MAX_PATTERN_INPUT,
    MAX_PATTERN_LENGTH,
    MAX_PURPOSES,
    MAX_PURPOSE_LENGTH,
    MAX_SUMMARY_LENGTH,
    MIN_PURPOSES,
    checkPurposes,
    isComponentCategory,
    normalizePurpose,
    PROPERTY_KEYS,
    PROPERTY_TYPES,
    SHAPE_KEYS,
    VALIDATORS,
    buildDefaults,
    collectComponentTokens,
    isSafeUrl,
    parseShape,
    reflectedProperties,
    typesOf,
    nodeChildren,
    validateNode
} from './shape/index.js';
export type {
    Bounds,
    CollectedTokens,
    ComponentCategory,
    KeyRule,
    NodeChild,
    PropertyShape,
    PropertyType,
    RequiredWhen,
    RuleContext,
    Shape,
    ShapeResult,
    ShapeSource,
    ValidateContext,
    ValidatorOptions
} from './shape/index.js';
export {
    applyPattern,
    checkComposedExposes,
    checkExposes,
    checkPattern,
    checkPatternPurposes,
    exposedPathResolves,
    EXPOSES_KEY,
    fitsParamType,
    parseComposed,
    patternComponents,
    readPattern,
    scanLibrary,
    withoutExposes
} from './convention/index.js';
export type { AppliedSlot, ApplyPatternResult, ExposedPath, ExposesIssue, ParsedComposed, PatternPurposes, ReadPatternResult } from './convention/index.js';
export type { ComponentFiles, ComponentTier, FileMap, ScanResult, ScannedComponent } from './convention/index.js';
export { RUNTIME_PATHS, applyLinks, disposeLinks, extractLinks, resolveRowLinks, runtimePath } from './links/index.js';
export type { ExtractOptions, ExtractResult, Link, LinkStore, ReferenceOptions, RowLinkOptions } from './links/index.js';
export { checkComposedNames, cloneJson, mergeValues, resolveNode } from './resolve/index.js';
export type {
    ComponentLibrary,
    ComposedEntry,
    DocumentComposed,
    LibraryEntry,
    ResolveOptions,
    ResolveResult,
    RootEntry
} from './resolve/index.js';
export { diffInstance, layInstance, snapshotState } from './snapshot/index.js';
export type { AppInstance, InstanceBase, LaidInstance, SnapshotOptions, SnapshotStore, StateSnapshot } from './snapshot/index.js';
export {
    COMMAND_KEYS,
    SYSTEM_COMMANDS,
    findProvider,
    findRowProvider,
    isSystemCommand,
    parseTarget,
    readCommand,
    readEntry,
    resolveTarget,
    validateOn
} from './on/index.js';
export type {
    Frame,
    Located,
    OnCommand,
    OnEntry,
    ParsedTarget,
    ResolvedTree,
    SystemCommand,
    TreeNode,
    ValidateOnOptions
} from './on/index.js';
export { documentValidators, libraryFromCatalog, registerDocumentValidator, validateDocument } from './validate/index.js';
export type {
    CatalogComponent,
    CatalogSource,
    DocumentValidation,
    DocumentValidationContext,
    DocumentValidator,
    ValidateDocumentOptions,
    AppMode
} from './validate/index.js';
export {
    DEFAULT_LEAVES,
    DEFAULT_TOKENS,
    MIN_CONTRAST,
    MIN_DATA_CONTRAST,
    TOKENS_STATE_PATH,
    TOKEN_TYPES,
    TokenNameError,
    checkContrast,
    componentTypeMap,
    contrastRatio,
    cssName,
    flattenTokens,
    hasInjection,
    inferComponentDefault,
    mergeOverDefaults,
    parseValue,
    referencesOf,
    toCssValue,
    tokenLayer,
    tokenTypeOf,
    validateReferences,
    validateTokenNames,
    validateTokenValue,
    KIND_GROUPS,
    OVERLAY_KINDS,
    OVERLAY_REASONS,
    SHIPPED_OVERLAYS,
    SYSTEM,
    SYSTEM_KINDS,
    THEME_KEY,
    THEME_VALIDATOR,
    activeAfterSwitch,
    appThemeNames,
    buildOverlayCatalog,
    composeOverlays,
    hasAppTheme,
    hasOverlay,
    isOverlayKind,
    mergeTokenTrees,
    overlayError,
    startTheme,
    themeSource,
    themeWords,
    validateAppThemes,
    validateNodeThemes,
    validateTheme,
    validateThemeOverlay,
    validateThemeOverlays,
    validateThemeTokens,
    validateTokens
} from './theme/index.js';
export type {
    ComponentDefaultResult,
    ComponentToken,
    OverlayCatalog,
    OverlayKind,
    ThemeOverlays,
    ThemeSource,
    TokenOverlay,
    ValidateOverlayOptions,
    TokenLayer,
    TokenLeaf,
    TokenTree,
    TokenType,
    TypeLookup,
    ValidateTokensOptions,
    ValuePart
} from './theme/index.js';
export {
    ARTICULATION_LISTS,
    ARTICULATION_NAMES,
    HIDDEN,
    SHARED_NAMES,
    attributeName,
    closedList,
    isArticulationName,
    isSharedName
} from './articulation/index.js';
export type { ArticulationName, SharedName } from './articulation/index.js';
export {
    MAX_MISSING_PER_LANGUAGE,
    buildAppOverlay,
    extractBaseOverlay,
    findUntranslated,
    isContentKey,
    validateAppLocale,
    validateComponentOverlay,
    validateDocumentLocales,
    validateLocaleOverlay
} from './locale/index.js';
export type { AppOverlayOptions, ComponentOverlays, LocaleOverlayOptions } from './locale/index.js';
export {
    ALIGNS,
    BREAKPOINTS,
    COLLAPSE_BELOW,
    GAPS,
    LAYOUTS,
    LAYOUT_TYPES,
    REGIONS,
    fitsField,
    isLayoutType,
    validateLayouts,
    validatePlacements
} from './layout/index.js';
export type { Breakpoint, FieldSpec, LayoutDefinition, LayoutType } from './layout/index.js';
export {
    LOGIC_COMMANDS,
    LOGIC_COMMAND_KEYS,
    LOGIC_FAILED_EVENT,
    LOGIC_FUNCTIONS,
    LOGIC_ORIGIN,
    MAX_CHAIN_DEPTH,
    MAX_DELAY,
    MODULE_UNIT_SEPARATOR,
    NOTIFY_PREFIX,
    LogicError,
    compilePattern,
    createLogicEngine,
    createLogicIndex,
    instantiateModule,
    logicRunOrder,
    matchPattern,
    queryRecords,
    readLogic,
    readModule
} from './logic/index.js';
export type {
    LogicAnswer,
    LogicChange,
    LogicCommand,
    LogicCommandName,
    InstantiateModuleOptions,
    InstantiateModuleResult,
    LogicDocument,
    LogicEngine,
    LogicFailure,
    LogicHost,
    LogicIndex,
    LogicIndexScreens,
    LogicMachine,
    LogicResult,
    LogicRow,
    LogicRule,
    LogicTable,
    LogicTraceEvent,
    LogicTraceOutcome,
    LogicTraceRun,
    LogicTransition,
    LogicTrigger,
    LogicUnitKind,
    LogicUnitPlace,
    LogicWrite,
    PathPattern,
    PatternMatch,
    ReadLogicOptions,
    RecordQuery,
    RecordQueryResult,
    ReadLogicResult,
    ReadModuleResult
} from './logic/index.js';
export { BM25_B, BM25_K1, FIELD_WEIGHTS, STOP_WORDS, SYNONYM_GROUPS, createSearchIndex, stem, synonymExpander, tokenize, words } from './search/index.js';
export type { SearchEntry, SearchFields, SearchHit, SearchIndex, SearchOptions, SynonymExpander } from './search/index.js';
export { MAX_FLATTEN_SEGMENTS, flattenPath, parsePathData, pathBounds } from './geometry/index.js';
export type { FlatSubpath, PathBounds, PathCommand, PathCommandType, PathDataResult, PathPoint } from './geometry/index.js';
export {
    FIELD_TYPES,
    PART_KINDS,
    PATTERN_KINDS,
    PATTERN_PARAM_TYPES,
    declarationProblems,
    isFieldType,
    isKeyName,
    isPartName,
    readBlueprint,
    slugifyName
} from './blueprint/index.js';
export { applyDefaults, checkDataset, checkRecord, inferModel, readModel } from './models/index.js';
export type { ReadModelResult } from './models/index.js';
export type {
    AppBlueprint,
    BlueprintScreen,
    BlueprintUses,
    ComposedPart,
    DataBinding,
    DatasetBinding,
    DatasetPart,
    DeclarationProblem,
    FieldDeclaration,
    FieldType,
    LogicModule,
    ModelPart,
    ModuleNeed,
    ModuleUse,
    ParamDeclaration,
    PartKind,
    PartRef,
    PatternKind,
    PatternParam,
    PatternParamType,
    PatternPart,
    PatternSlot,
    PersonaBinding,
    ReadBlueprintResult,
    ThemePart,
    ThemePartOverlay
} from './blueprint/index.js';
export { assembleApp, nearestNames, validateApp } from './assemble/index.js';
export { checkSharedData } from './validate/index.js';
export type { AppValidation, AppValidationError, AssembleOptions, AssembleResult, PartSource, ValidateAppOptions } from './assemble/index.js';
export { splitDocument } from './convert/index.js';
export type { SplitInput, SplitProblem, SplitRename, SplitResult } from './convert/index.js';
export { NAVIGATE_COMMAND, ROUTE_PATH, checkNavigate, initialRoute, isRouteRefusal, paramDefaults, routeTo } from './route/index.js';
export type { NavigateProblem, RouteScreens, RouteState } from './route/index.js';
export { OUTLET_COMPONENT, findOutlet, screenPath } from './route/index.js';
export { FRAGMENT_PREFIX, formatFragment, parseFragment, sameRoute } from './route/index.js';
