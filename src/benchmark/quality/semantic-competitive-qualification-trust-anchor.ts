import type { SemanticQualificationTrustAnchor } from "./semantic-competitive-qualification.js";

// Publication remains fail-closed until the release process provisions a
// deployment-owned gate key and trust-store digest.
export const SEMANTIC_COMPETITIVE_QUALIFICATION_TRUST_ANCHOR: SemanticQualificationTrustAnchor | null =
	null;
