/// <reference types="@cloudflare/vitest-plugin/types" />
import type { ApprovalsNamespace } from '../../src/policy/approvals';

declare global {
  namespace Cloudflare {
    interface Env {
      APPROVALS: ApprovalsNamespace;
    }
  }
}
