import { WorkerEntrypoint } from "cloudflare:workers";
import { memberServiceRequest, type MemberEnv } from "./member-service.ts";
export { default } from "./app.ts";

// A named service binding is required. The public default Worker never routes
// requests here, and this entrypoint never dispatches a general owner API path.
export class GuestbookMemberService extends WorkerEntrypoint<MemberEnv> {
  fetch(request: Request): Promise<Response> {
    return memberServiceRequest(request, this.env, BUILD_SHA);
  }
}
declare const BUILD_SHA: string;
