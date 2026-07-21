/**
 * detectAssetUrlMode 핸들러 (이슈 #486 §8)
 *
 * 관리자 환경설정에서 자산 URL 방식을 **브라우저에서** 재감지한다.
 *
 * 서버측에서 자기 `APP_URL` 로 curl 하면 loopback 이 nginx vhost·SSL·프록시 체인을
 * 우회하거나 다른 vhost 를 타서 오판한다. 실제로 방문자가 겪는 경로를 재현하려면
 * 브라우저가 던져야 한다.
 *
 * 감지 지점이 인스톨러 하나로 부족한 이유가 여기 있다 — 관리자가 설치 6개월 뒤
 * 정적 최적화 블록을 추가하면 저장된 값은 "확장자 OK" 인 채 사이트가 다시 죽는다.
 * 이 버튼이 그 상황의 재판정 수단이다.
 */

const logger = ((window as any).G7Core?.createLogger?.('Handler:DetectAssetUrlMode')) ?? {
    log: (...args: unknown[]) => console.log('[Handler:DetectAssetUrlMode]', ...args),
    warn: (...args: unknown[]) => console.warn('[Handler:DetectAssetUrlMode]', ...args),
    error: (...args: unknown[]) => console.error('[Handler:DetectAssetUrlMode]', ...args),
};

/** 프로브 응답 본문에 담기는 매직 토큰 (서버 AssetProbeController::PROBE_TOKEN 과 동일) */
const PROBE_TOKEN = 'G7_ASSET_PROBE_OK';

/** 판정 결과 */
export type DetectResult = 'extension' | 'extensionless' | 'unavailable';

/**
 * 프로브 1건을 던져 성공 여부를 판정한다.
 *
 * 성공 판정은 상태코드가 아니라 **본문의 매직 토큰 + Content-Type** 이다.
 * 상태코드만 보면 "404 대신 200 + 에러 HTML" 이나 catch-all 200 페이지를 반환하는
 * 설정에서 영원히 `extension` 으로 오판해, 재감지를 몇 번 눌러도 같은 오답이 나온다.
 *
 * @param path 프로브 경로
 * @returns 매직 토큰이 확인되면 true
 */
async function probe(path: string): Promise<boolean> {
    try {
        const res = await fetch(path, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) return false;

        // Content-Type 이 스크립트가 아니면 정적 블록이 아닌 다른 것이 응답한 것
        const contentType = res.headers.get('content-type') ?? '';
        if (!/javascript|ecmascript/i.test(contentType)) return false;

        return (await res.text()).includes(PROBE_TOKEN);
    } catch (e) {
        return false;
    }
}

/**
 * 프로브 쌍을 던져 자산 URL 방식을 판정한다.
 *
 * 단일 프로브는 "PHP 자체가 죽음" 과 구분되지 않으므로 반드시 쌍으로 던진다.
 *
 * | probe.js | probe | 판정 |
 * |---|---|---|
 * | 성공 | 성공 | `extension` |
 * | 실패 | 성공 | `extensionless` (정적 블록 가로채기 확정) |
 * | 그 외 | | `unavailable` (모드 문제 아님 — PHP/라우팅 장애) |
 *
 * @returns 판정 결과
 */
export async function detectAssetUrlMode(): Promise<DetectResult> {
    const [withExt, withoutExt] = await Promise.all([
        probe('/api/system/asset-probe.js'),
        probe('/api/system/asset-probe'),
    ]);

    if (withExt && withoutExt) return 'extension';
    if (!withExt && withoutExt) return 'extensionless';

    return 'unavailable';
}

/**
 * 자산 URL 방식 자동 감지 핸들러.
 *
 * 판정 결과를 폼 상태(`general.asset_url_mode`)에 반영하고 토스트로 안내한다.
 * **저장은 하지 않는다** — 관리자가 결과를 보고 저장 버튼을 누르는 흐름을 유지해,
 * 감지가 오판했을 때 되돌릴 여지를 남긴다.
 *
 * 판정 불가(`unavailable`)면 값을 건드리지 않는다. 서버가 응답하지 않는 상황에서
 * 임의 값을 넣으면 멀쩡한 설정을 덮어쓸 수 있다.
 *
 * @param _action 액션 정의 (미사용)
 * @param context 액션 컨텍스트 (setState 등)
 */
export async function detectAssetUrlModeHandler(
    _action: any,
    context?: any,
): Promise<void> {
    const G7Core = (window as any).G7Core;

    try {
        G7Core?.dispatch?.({
            handler: 'toast',
            params: { message: '$t:admin.settings.general.asset_url_mode_detecting', type: 'info' },
        });

        const result = await detectAssetUrlMode();

        if (result === 'unavailable') {
            G7Core?.dispatch?.({
                handler: 'toast',
                params: { message: '$t:admin.settings.general.asset_url_mode_detect_unavailable', type: 'error' },
            });

            return;
        }

        // 폼 상태에 반영 (저장은 관리자가 명시적으로 수행)
        const setState = context?.setState ?? G7Core?.state?.setLocal;
        if (typeof setState === 'function') {
            setState({ 'general.asset_url_mode': result });
        } else {
            logger.warn('setState 를 찾지 못해 감지 결과를 폼에 반영하지 못했습니다');
        }

        G7Core?.dispatch?.({
            handler: 'toast',
            params: {
                message: `$t:admin.settings.general.asset_url_mode_detect_${result}`,
                type: result === 'extension' ? 'success' : 'warning',
            },
        });
    } catch (e) {
        logger.error('자산 URL 방식 감지 실패:', e);
        G7Core?.dispatch?.({
            handler: 'toast',
            params: { message: '$t:admin.settings.general.asset_url_mode_detect_unavailable', type: 'error' },
        });
    }
}
