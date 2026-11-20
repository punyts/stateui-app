import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerAppRequests } from './answer.js';
import { APP_OPEN_EVENT } from './types.js';
import type { AppHost, AppOpenRequest, EmbeddedApp } from './types.js';

describe('answerAppRequests with an app its host attaches', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('should have the host attach the app in the request\'s element, without mounting a document', async () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));
        const element = host.appendChild(document.createElement('section'));
        const attached: EmbeddedApp = { navigate: () => undefined, dispose: () => undefined };
        const attach = vi.fn<(request: Pick<AppOpenRequest, 'element' | 'screen' | 'onEmit' | 'onNavigate'>) => EmbeddedApp>(() => attached);
        const apps: AppHost = { open: () => Promise.resolve({ attach }) };
        const mount = vi.fn();
        const stop = answerAppRequests(host, apps, mount);
        let result: Promise<EmbeddedApp> | undefined;
        const onEmit = (): void => undefined;
        const onNavigate = (): void => undefined;
        const detail = { app: 'shop', live: true, screen: 'cart', element, onEmit, onNavigate, respond: (given: Promise<EmbeddedApp>) => void (result = given) };

        // Act
        element.dispatchEvent(new CustomEvent(APP_OPEN_EVENT, { detail, bubbles: true, composed: true }));
        const embedded = await result;
        stop();

        // Assert
        expect(embedded).toBe(attached);
        expect(attach).toHaveBeenCalledTimes(1);
        expect(attach.mock.calls[0]?.[0]).toMatchObject({ element, screen: 'cart', onEmit, onNavigate });
        expect(mount).not.toHaveBeenCalled();
    });
});
