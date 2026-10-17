// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
export declare function health(request: Request, path: string, app: string, revision: string): Response | null;
export interface PublisherEnv {
    USAGE_ENDPOINT?: string;
    USAGE_TOKEN?: string;
}
export declare function publish(env: PublisherEnv, context: Pick<ExecutionContext, "waitUntil"> | undefined, request: Request, event: string, send?: typeof fetch): void;
export declare function pageEvent(request: Request, response: Response, base?: string): string | null;
export declare function postcardReceiptEvent(request: Request, response: Response, base?: string): string | null;
