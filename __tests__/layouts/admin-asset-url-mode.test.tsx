/**
 * @file admin-asset-url-mode.test.tsx
 * @description 자산 URL 이중 모드 관련 레이아웃 렌더링 테스트 (이슈 #486 §검증)
 *
 * 계획서 §검증 "회귀 테스트" 표의 레이아웃 렌더링 계층 — `createLayoutTest()` 로
 * **두 모드 각각** 렌더한다.
 *
 * 이 계층이 잡는 것:
 *
 * 1. **모드가 렌더링에 새어나오지 않는다.** 자산 URL 모드는 URL 생성에만 관여하고
 *    화면 구조를 바꾸지 않아야 한다. 누군가 컴포넌트를 모드에 따라 분기시키면
 *    확장자 없는 환경에서만 화면이 달라지는데, 그 환경은 개발 중에 거의 재현되지 않아
 *    발견이 늦다. 두 모드의 DOM 을 직접 대조해 잠근다.
 * 2. **대시보드 드리프트 안내와 환경설정 감지 UI 가 실제로 렌더된다.** 두 화면 모두
 *    "설정이 어긋난 상태" 를 관리자에게 알리는 유일한 통로다.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLayoutTest, screen } from '@core/template-engine/__tests__/utils/layoutTestUtils';
import { ComponentRegistry } from '@core/template-engine/ComponentRegistry';
import { MODE_EXTENSION, MODE_EXTENSIONLESS } from '@core/support/assetUrl';

const TestDiv: React.FC<any> = ({ className, children, 'data-testid': testId }) => (
    <div className={className} data-testid={testId}>{children}</div>
);

const TestSpan: React.FC<any> = ({ className, children, text }) => (
    <span className={className}>{children || text}</span>
);

const TestP: React.FC<any> = ({ className, children, text }) => (
    <p className={className}>{children || text}</p>
);

const TestButton: React.FC<any> = ({ className, type, children, text, onClick }) => (
    <button className={className} type={type} onClick={onClick}>{children || text}</button>
);

const TestLabel: React.FC<any> = ({ className, children, text }) => (
    <label className={className}>{children || text}</label>
);

const TestIcon: React.FC<any> = ({ icon, className }) => (
    <i className={className} data-icon={icon} />
);

const TestSelect: React.FC<any> = ({ name, options, disabled }) => (
    <select name={name} disabled={disabled} data-testid={`select-${name}`}>
        {(options ?? []).map((o: any) => (
            <option key={o.value} value={o.value}>{o.label}</option>
        ))}
    </select>
);

const TestFragment: React.FC<any> = ({ children }) => <>{children}</>;

/**
 * 레이아웃 테스트용 컴포넌트 레지스트리를 구성한다.
 *
 * Fragment 를 빠뜨리면 자식 트리가 통째로 렌더되지 않고 빈 컨테이너만 남아,
 * 부정 단언("없어야 한다")이 거짓 통과한다.
 */
function setupTestRegistry(): ComponentRegistry {
    const registry = ComponentRegistry.getInstance();

    (registry as any).registry = {
        Div: { component: TestDiv, metadata: { name: 'Div', type: 'basic' } },
        Span: { component: TestSpan, metadata: { name: 'Span', type: 'basic' } },
        P: { component: TestP, metadata: { name: 'P', type: 'basic' } },
        Button: { component: TestButton, metadata: { name: 'Button', type: 'basic' } },
        Label: { component: TestLabel, metadata: { name: 'Label', type: 'basic' } },
        Icon: { component: TestIcon, metadata: { name: 'Icon', type: 'basic' } },
        Select: { component: TestSelect, metadata: { name: 'Select', type: 'composite' } },
        Fragment: { component: TestFragment, metadata: { name: 'Fragment', type: 'layout' } },
    };

    return registry;
}

/**
 * 서버가 내려주는 자산 URL 모드를 흉내낸다.
 *
 * @param mode 자산 URL 모드
 */
function setServerMode(mode: string): void {
    (globalThis as any).G7Config = {
        ...((globalThis as any).G7Config ?? {}),
        assetUrlMode: mode,
        settings: { general: { asset_url_mode: mode } },
    };
}

/** 환경설정 > 일반 탭의 자산 URL 방식 필드 (레이아웃 원본과 동일 구조) */
const settingsFieldLayout = {
    components: [
        {
            id: 'field_asset_url_mode',
            type: 'basic',
            name: 'Div',
            children: [
                {
                    type: 'basic',
                    name: 'Label',
                    props: { className: 'form-label' },
                    children: [{ type: 'basic', name: 'Span', text: '자산 파일 주소 방식' }],
                },
                {
                    type: 'basic',
                    name: 'P',
                    props: { className: 'form-help' },
                    text: '서버 설정을 자동으로 감지합니다',
                },
                {
                    type: 'basic',
                    name: 'Div',
                    props: { className: 'flex gap-2 items-start' },
                    children: [
                        {
                            type: 'basic',
                            name: 'Div',
                            props: { className: 'flex-1' },
                            children: [
                                {
                                    type: 'composite',
                                    name: 'Select',
                                    props: {
                                        name: 'general.asset_url_mode',
                                        className: 'w-full',
                                        options: [
                                            { value: 'extension', label: '확장자 사용' },
                                            { value: 'extensionless', label: '확장자 미사용' },
                                        ],
                                    },
                                },
                            ],
                        },
                        {
                            type: 'basic',
                            name: 'Button',
                            props: { type: 'button', className: 'btn-secondary whitespace-nowrap' },
                            children: [{ type: 'basic', name: 'Span', text: '지금 감지' }],
                            actions: [{ event: 'onClick', handler: 'detectAssetUrlMode' }],
                        },
                    ],
                },
            ],
        },
    ],
};

/** 대시보드 드리프트 안내 (레이아웃 원본과 동일한 if 조건) */
const driftAlertLayout = {
    components: [
        {
            id: 'asset_url_mode_drift_alert',
            type: 'basic',
            name: 'Div',
            if: '{{_global.assetUrlModeDrift}}',
            props: { className: 'flex items-start gap-3 p-4 mb-6 rounded-lg', 'data-testid': 'drift-alert' },
            children: [
                {
                    type: 'basic',
                    name: 'Icon',
                    props: { icon: 'fa-solid fa-triangle-exclamation', className: 'text-base' },
                },
                {
                    type: 'basic',
                    name: 'Div',
                    props: { className: 'flex-1 min-w-0' },
                    children: [
                        {
                            type: 'basic',
                            name: 'Div',
                            props: { className: 'text-sm font-semibold' },
                            text: '자산 파일 주소 방식이 서버 환경과 다릅니다',
                        },
                        {
                            type: 'basic',
                            name: 'Button',
                            props: { type: 'button', className: 'mt-2 underline' },
                            text: '환경설정에서 확인하기',
                            actions: [
                                { type: 'click', handler: 'navigate', params: { path: '/admin/settings' } },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

const BOTH_MODES = [MODE_EXTENSION, MODE_EXTENSIONLESS];

describe('자산 URL 이중 모드 — 레이아웃 렌더링 (§검증)', () => {
    beforeEach(() => {
        setupTestRegistry();
    });

    afterEach(() => {
        delete (globalThis as any).G7Config;
    });

    describe('환경설정 > 일반 — 자산 URL 방식 필드', () => {
        it.each(BOTH_MODES)('%s 모드에서 선택 컨트롤과 감지 버튼이 렌더된다', async (mode) => {
            setServerMode(mode);

            const t = createLayoutTest(settingsFieldLayout as any);
            await t.render();

            const select = screen.getByTestId('select-general.asset_url_mode');
            expect(select, `${mode} 모드에서 자산 URL 방식 선택 컨트롤이 렌더되지 않았다`).toBeInTheDocument();

            // 두 선택지는 모드와 무관하게 항상 제공되어야 한다 — 현재 모드만 보이면
            // 잘못 판정된 환경에서 관리자가 되돌릴 방법이 사라진다.
            expect(select.querySelectorAll('option')).toHaveLength(2);
            expect(screen.getByText('지금 감지')).toBeInTheDocument();

            t.cleanup();
        });

        it('두 모드의 렌더 결과가 완전히 동일하다 (모드는 URL 생성에만 관여)', async () => {
            const html: string[] = [];

            for (const mode of BOTH_MODES) {
                setServerMode(mode);
                const t = createLayoutTest(settingsFieldLayout as any);
                const { container } = await t.render();
                html.push(container.innerHTML);
                t.cleanup();
            }

            // 렌더가 아예 안 되면 ''  === '' 로 항상 통과한다. 비교 대상이 실재하는지 먼저 못박는다.
            expect(html[0], '렌더 결과가 비어 있어 두 모드 비교가 무의미하다').toContain('general.asset_url_mode');

            expect(
                html[0],
                '모드에 따라 레이아웃 렌더 결과가 달라졌다 — 자산 URL 모드가 화면 구조로 새어나오고 있다',
            ).toBe(html[1]);
        });
    });

    describe('대시보드 — 자산 URL 방식 드리프트 안내', () => {
        it.each(BOTH_MODES)('%s 모드에서 드리프트가 없으면 안내가 렌더되지 않는다', async (mode) => {
            setServerMode(mode);

            const t = createLayoutTest(driftAlertLayout as any);
            await t.render();

            expect(
                screen.queryByTestId('drift-alert'),
                '드리프트가 없는데 경고가 떴다 — 상시 경고는 신호가 아니라 소음이 된다',
            ).not.toBeInTheDocument();

            t.cleanup();
        });

        it.each(BOTH_MODES)('%s 모드에서 드리프트가 감지되면 안내와 이동 버튼이 렌더된다', async (mode) => {
            setServerMode(mode);

            const t = createLayoutTest(driftAlertLayout as any, {
                initialState: {
                    _global: {
                        assetUrlModeDrift: { detected: 'extensionless', stored: 'extension' },
                    },
                },
            });
            await t.render();

            expect(screen.getByTestId('drift-alert')).toBeInTheDocument();
            expect(screen.getByText('자산 파일 주소 방식이 서버 환경과 다릅니다')).toBeInTheDocument();
            expect(screen.getByText('환경설정에서 확인하기')).toBeInTheDocument();

            t.cleanup();
        });
    });
});
