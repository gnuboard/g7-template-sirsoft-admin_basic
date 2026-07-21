/**
 * detectAssetUrlMode 감지 로직 테스트 — 이슈 #486 §12 L6 전용 가드
 *
 * L6: "프로브 판정은 **본문 매직 토큰 + Content-Type** 기준"
 *
 * 이 불변식이 막는 사고는 구체적이다 — 일부 서버는 없는 경로에 404 대신
 * `200 + 에러 HTML` 이나 catch-all 페이지를 반환한다. 상태코드만 보면 그 응답을
 * "프로브 성공" 으로 읽어 영원히 `extension` 으로 오판하고, 관리자가 재감지를
 * 몇 번 눌러도 같은 오답이 나온다.
 *
 * 로직·주석·구현은 실재하지만 **negative branch 회귀 가드가 없었다**. 즉 누군가
 * Content-Type 검사나 토큰 검사를 지워도 아무 테스트도 red 가 되지 않는 상태였다.
 * 본 파일이 그 구멍을 막는다.
 */

// e2e:allow 프로브 판정의 순수 분기 로직 단위. 브라우저 시나리오는 asset-url-mode.spec.ts 담당.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectAssetUrlMode } from '../detectAssetUrlModeHandler';

/** 서버 AssetProbeController::PROBE_TOKEN 과 동일해야 하는 값 */
const TOKEN = 'G7_ASSET_PROBE_OK';

/** 정상 프로브 응답 본문 */
const VALID_BODY = `/* G7 asset URL mode probe */\nwindow.__g7AssetProbe = '${TOKEN}';\n`;

/**
 * fetch 응답을 흉내낸다.
 *
 * @param init 상태·본문·Content-Type
 */
function mockResponse(init: { ok?: boolean; body?: string; contentType?: string }) {
    return {
        ok: init.ok ?? true,
        headers: { get: () => init.contentType ?? 'application/javascript; charset=utf-8' },
        text: async () => init.body ?? VALID_BODY,
    };
}

describe('detectAssetUrlMode — 프로브 판정 (§12 L6)', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        (globalThis as any).fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * 경로별 응답을 지정한다.
     *
     * @param withExt `/api/system/asset-probe.js` 응답
     * @param withoutExt `/api/system/asset-probe` 응답
     */
    const respond = (withExt: any, withoutExt: any) => {
        fetchSpy.mockImplementation(async (url: string) =>
            url.endsWith('.js') ? withExt : withoutExt,
        );
    };

    describe('정상 판정', () => {
        it('둘 다 성공하면 extension', async () => {
            respond(mockResponse({}), mockResponse({}));

            await expect(detectAssetUrlMode()).resolves.toBe('extension');
        });

        it('확장자 형태만 실패하면 extensionless (정적 블록 가로채기 확정)', async () => {
            respond(mockResponse({ ok: false }), mockResponse({}));

            await expect(detectAssetUrlMode()).resolves.toBe('extensionless');
        });

        it('둘 다 실패하면 unavailable (모드 문제 아님 — PHP/라우팅 장애)', async () => {
            respond(mockResponse({ ok: false }), mockResponse({ ok: false }));

            await expect(detectAssetUrlMode()).resolves.toBe('unavailable');
        });

        it('확장자 없는 형태만 실패해도 unavailable (전환해도 소용없는 상태)', async () => {
            respond(mockResponse({}), mockResponse({ ok: false }));

            await expect(detectAssetUrlMode()).resolves.toBe('unavailable');
        });
    });

    describe('L6 — 상태코드만으로 판정하지 않는다', () => {
        // 계획서 §12 L6 이 명시한 시나리오: "200-but-wrong-body 환경에서
        // 재감지가 영원히 같은 오답" 을 내면 안 된다.
        it('200 + 에러 HTML 을 성공으로 오판하지 않는다', async () => {
            const errorPage = mockResponse({
                ok: true,
                body: '<html><body>404 Not Found</body></html>',
                contentType: 'text/html; charset=utf-8',
            });

            // 확장자 형태가 catch-all HTML 을 받고, 확장자 없는 형태는 정상
            respond(errorPage, mockResponse({}));

            await expect(
                detectAssetUrlMode(),
                '200+HTML 을 프로브 성공으로 오판했다 — 정적 블록 가로채기를 놓친다',
            ).resolves.toBe('extensionless');
        });

        // 계획서 §"루프 방지 전용 테스트" L6 행의 **문자 그대로의 시나리오**:
        //   "프로브 응답을 200 + <html>에러페이지</html> 로 가로챈다
        //    → 감지 결과가 extension 이 아니라 '판정 불가/PHP 문제' 로 분기"
        //
        // 위의 '둘 다 실패' 케이스(ok:false)와는 **다른 코드 경로**다. 404 는
        // `!res.ok` 에서 조기 반환되지만, 200+본문오류는 Content-Type·토큰 검사를
        // 통과해야 걸러진다. 두 검사가 사라지면 이 케이스만 조용히 extension 으로
        // 오판되고, 관리자는 재감지를 몇 번 눌러도 같은 오답을 받는다.
        it('둘 다 200 + 에러 HTML 이면 판정 불가로 분기한다 (catch-all 서버)', async () => {
            const catchAllPage = () =>
                mockResponse({
                    ok: true,
                    body: '<html><body>Page Not Found</body></html>',
                    contentType: 'text/html; charset=utf-8',
                });

            respond(catchAllPage(), catchAllPage());

            await expect(
                detectAssetUrlMode(),
                'catch-all 200 페이지를 프로브 성공으로 읽어 extension 으로 오판했다',
            ).resolves.toBe('unavailable');
        });

        it('Content-Type 이 스크립트가 아니면 토큰이 있어도 실패로 본다', async () => {
            // 토큰을 그대로 담았지만 text/html 로 응답하는 catch-all 페이지
            const htmlWithToken = mockResponse({
                ok: true,
                body: `<html><body>${TOKEN}</body></html>`,
                contentType: 'text/html; charset=utf-8',
            });

            respond(htmlWithToken, mockResponse({}));

            await expect(
                detectAssetUrlMode(),
                'Content-Type 검사가 없어 HTML 응답을 프로브 성공으로 읽었다',
            ).resolves.toBe('extensionless');
        });

        it('매직 토큰이 없으면 Content-Type 이 맞아도 실패로 본다', async () => {
            // JS 로 응답하지만 우리 프로브가 아닌 다른 스크립트 (CDN 폴백 등)
            const otherScript = mockResponse({
                ok: true,
                body: 'console.log("some other script");',
                contentType: 'application/javascript',
            });

            respond(otherScript, mockResponse({}));

            await expect(
                detectAssetUrlMode(),
                '토큰 검사가 없어 무관한 JS 응답을 프로브 성공으로 읽었다',
            ).resolves.toBe('extensionless');
        });

        it('application/javascript 외 스크립트 MIME 도 허용한다', async () => {
            // 일부 서버는 text/javascript / application/ecmascript 로 응답한다
            for (const contentType of ['text/javascript', 'application/ecmascript']) {
                respond(mockResponse({ contentType }), mockResponse({ contentType }));

                await expect(
                    detectAssetUrlMode(),
                    `${contentType} 를 스크립트로 인정하지 않았다`,
                ).resolves.toBe('extension');
            }
        });
    });

    describe('네트워크 예외', () => {
        it('fetch 가 throw 해도 판정이 죽지 않는다', async () => {
            fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

            await expect(detectAssetUrlMode()).resolves.toBe('unavailable');
        });
    });

    describe('프로브 요청 형태', () => {
        it('두 경로를 쌍으로 던지고 캐시를 쓰지 않는다', async () => {
            respond(mockResponse({}), mockResponse({}));

            await detectAssetUrlMode();

            const urls = fetchSpy.mock.calls.map((c) => c[0]);
            expect(urls).toContain('/api/system/asset-probe.js');
            expect(urls).toContain('/api/system/asset-probe');

            for (const call of fetchSpy.mock.calls) {
                expect(call[1]?.cache, '프로브가 캐시될 수 있는 요청으로 나갔다').toBe('no-store');
            }
        });
    });
});
