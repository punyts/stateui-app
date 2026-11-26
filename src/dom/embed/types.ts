import type { Store } from '@punyts/state';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { AppDocument } from '../../core/types.js';
import type { DispatchHooks, RaisedReport } from '../on/types.js';
import type { MountedApp, MountOptions } from '../mount/types.js';

/**
 * The event an `embeddedApp` raises on its own element to have an app mounted inside it. Bubbles and is composed; the
 * `mountApp` of the page it is in answers it through its `apps` host and stops it
 */
export const APP_OPEN_EVENT = 'ui-app-open';

/** Which app a page asks its app host for: a name the host knows, never a URL */
export interface AppAsk {
    /** The app's name, as the page's host knows it */
    readonly app: string;
    /** The screen it opens on; its start screen when absent */
    readonly screen?: string;
    /** The app itself (synced, takes input) rather than a preview of it */
    readonly live: boolean;
}

/** The `detail` of `ui-app-open` */
export interface AppOpenRequest extends AppAsk {
    /** Where the app is mounted: an element inside the asking component */
    readonly element: Element;
    /** Called with each event a node with an `@id` raises in the app inside, after the host's own `onRaised` */
    readonly onRaised: (report: RaisedReport) => void;
    /** Called with the screen the app inside shows, when it moves to another screen itself */
    readonly onNavigate: (screen: string) => void;
    /**
     * Called once, synchronously, with the mounted app or the reason it was not mounted (the promise rejects). A
     * request nothing answers (no app host) is never responded to
     */
    readonly respond: (result: Promise<EmbeddedApp>) => void;
}

/** An app mounted inside a component, as the component holds it */
export interface EmbeddedApp {
    /** Moves the app to another of its screens; returns why it cannot, undefined when it moved */
    navigate(screen: string): string | undefined;
    /** Unmounts the app and stops following anything; safe to call more than once */
    dispose(): void;
}

/** What an app host gives for an app it opens */
export interface OpenedApp {
    readonly document: AppDocument;
    readonly library: ComponentLibrary;
    /** How the app keeps its state, the person's instance, its function catalogs and its own app host */
    readonly options?: Pick<MountOptions, 'mode' | 'instance' | 'functions' | 'apps'>;
    /** The app's own hooks: its files, its 3D chunk, its emits */
    readonly hooks?: DispatchHooks;
    /**
     * The store of the app this one previews: its `$.data` is copied in at mount and every change to it is written
     * after, so the preview shows the live app's data without messages. The preview never writes it back
     */
    readonly follows?: Store<unknown>;
    /** Called once the app is mounted, so the host can hand its store to the previews of it */
    readonly mounted?: (app: MountedApp) => void;
    /** Called when the app is disposed */
    readonly disposed?: (app: MountedApp) => void;
}

/**
 * What an app host gives for an app it mounts itself: one whose runtime it runs, such as a live app whose sync client
 * writes its store. The host mounts it in the request's element, on its screen, calls `onRaised` and `onNavigate` as the
 * app's nodes raise events and it moves, and leaves the document title alone
 */
export interface AttachedApp {
    attach(request: Pick<AppOpenRequest, 'element' | 'screen' | 'onRaised' | 'onNavigate'>): EmbeddedApp;
}

/**
 * The page's adapter for the apps it shows inside components (`MountOptions.apps`). It resolves a name for whoever is
 * signed in, and rejects one they may not open. The page passes it, as it passes the function catalogs
 */
export interface AppHost {
    open(ask: AppAsk): Promise<OpenedApp | AttachedApp>;
}
