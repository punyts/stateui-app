import { describe, expect, it } from 'vitest';
import { MAX_PATH_DATA_LENGTH } from '../shape/types.js';
import type { JsonValue } from '../types.js';
import { MAX_APP_ICONS, MAX_APP_ICON_PATHS, appIconNames, appIconProblems } from './appIcons.js';

const CHAT = 'M4 5h16v11H9l-5 4z';

/** The path and reason of each problem, as `path: reason` */
function problemsOf(value: JsonValue): string[] {
    return appIconProblems(value).map((problem) => `${problem.path}: ${problem.reason}`);
}

describe('appIconProblems', () => {
    it('should accept outline path data and styled paths with a filled variant', () => {
        // Arrange
        const icons: JsonValue = {
            chat: { outline: [CHAT] },
            prefs: { outline: ['M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0', { d: 'M12 4a8 8 0 0 0 0 16z', fill: true, stroke: false, opacity: 0.5 }], filled: [CHAT] }
        };

        // Act
        const problems = appIconProblems(icons);

        // Assert
        expect(problems).toEqual([]);
    });

    it('should refuse markup, url() and text that is not path data', () => {
        // Arrange
        const icons: JsonValue = {
            markup: { outline: ['<script>alert(1)</script>'] },
            link: { outline: ['url(#x)'] },
            styled: { outline: [{ d: 'M0 0 L1 1" onload="x' }] }
        };

        // Act
        const problems = problemsOf(icons);

        // Assert
        expect(problems.map((problem) => problem.split(':')[0])).toEqual(['$.icons.markup.outline.0', '$.icons.link.outline.0', '$.icons.styled.outline.0.d']);
    });

    it('should refuse path data over MAX_PATH_DATA_LENGTH characters and accept it at the limit', () => {
        // Arrange
        const head = 'M0 0';
        const atLimit = head + ' '.repeat(MAX_PATH_DATA_LENGTH - head.length);

        // Act
        const accepted = appIconProblems({ fit: { outline: [atLimit] } });
        const refused = appIconProblems({ long: { outline: [`${atLimit} `] } });

        // Assert
        expect(accepted).toEqual([]);
        expect(refused.map((problem) => problem.path)).toEqual(['$.icons.long.outline.0']);
    });

    it('should refuse other attributes on a styled path and other keys on an icon', () => {
        // Arrange
        const icons: JsonValue = { chat: { outline: [{ d: CHAT, style: 'fill:red', fill: 'red' }], stroke: [CHAT] } };

        // Act
        const problems = problemsOf(icons);

        // Assert
        expect(problems).toEqual([
            '$.icons.chat.stroke: unknown key "stroke"',
            '$.icons.chat.outline.0.style: unknown key "style"',
            '$.icons.chat.outline.0.fill: must be true when given'
        ]);
    });

    it('should refuse a bad name, an empty outline and too many paths', () => {
        // Arrange
        const icons: JsonValue = {
            Chat: { outline: [CHAT] },
            empty: { outline: [] },
            many: { outline: Array.from({ length: MAX_APP_ICON_PATHS + 1 }, () => CHAT) }
        };

        // Act
        const problems = appIconProblems(icons);

        // Assert
        expect(problems.map((problem) => problem.path)).toEqual(['$.icons.Chat', '$.icons.empty.outline', '$.icons.many.outline']);
    });

    it('should refuse more than MAX_APP_ICONS icons and a value that is not a map', () => {
        // Arrange
        const many = Object.fromEntries(Array.from({ length: MAX_APP_ICONS + 1 }, (_, index) => [`i${index}`, { outline: [CHAT] }]));

        // Act
        const tooMany = appIconProblems(many);
        const notMap = appIconProblems([CHAT]);

        // Assert
        expect(tooMany).toHaveLength(1);
        expect(notMap.map((problem) => problem.path)).toEqual(['$.icons']);
    });
});

describe('appIconNames', () => {
    it('should name the icons of a map and none of anything else', () => {
        // Act
        const names = appIconNames({ chat: { outline: [CHAT] }, send: { outline: [CHAT] } });

        // Assert
        expect([...names]).toEqual(['chat', 'send']);
        expect(appIconNames(undefined).size).toBe(0);
        expect(appIconNames('chat').size).toBe(0);
    });
});
