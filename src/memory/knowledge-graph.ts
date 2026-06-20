/**
 * Knowledge Graph — Hebbian associative memory with spreading activation.
 *
 * Neuroscience basis:
 * - Hebbian learning: "neurons that fire together wire together"
 * - Spreading activation: activating one node propagates to connected nodes
 * - Ebbinghaus decay on edge weights: unused associations weaken
 *
 * Implementation inspired by:
 * - Zep/Graphiti temporal knowledge graph
 * - Ori-Mnemos Hebbian co-occurrence from retrieval patterns
 * - HippoRAG knowledge graph as hippocampal index
 */

/** A node in the knowledge graph (an entity) */
export interface KGNode {
	/** Entity name (lowercase, canonical) */
	name: string;
	/** How many times this entity has been referenced */
	frequency: number;
	/** Last time this entity was referenced */
	lastSeen: number;
}

/** An edge between two entities */
export interface KGEdge {
	/** Source entity */
	from: string;
	/** Target entity */
	to: string;
	/** Association weight (0.0–1.0) — Hebbian strength */
	weight: number;
	/** How many times this co-occurrence has been observed */
	coOccurrences: number;
}

/** Serializable graph state for persistence */
export interface KGState {
	nodes: Record<string, KGNode>;
	/** "from::to" → KGEdge (alphabetically sorted key) */
	edges: Record<string, KGEdge>;
}

export function emptyKGState(): KGState {
	return { nodes: {}, edges: {} };
}

/** Normalize entity name */
function normalize(name: string): string {
	return name.toLowerCase().trim();
}

/** Create edge key (alphabetically sorted for consistency) */
function edgeKey(a: string, b: string): string {
	const sorted = [normalize(a), normalize(b)].sort();
	return `${sorted[0]}::${sorted[1]}`;
}

/**
 * KnowledgeGraph — in-memory graph with Hebbian learning.
 * Operates on a shared KGState (stored in MemoryStore).
 */
export class KnowledgeGraph {
	constructor(private state: KGState) {}

	/**
	 * Register that an entity was seen.
	 */
	touchNode(name: string, now: number): void {
		const key = normalize(name);
		const existing = this.state.nodes[key];
		if (existing) {
			existing.frequency++;
			existing.lastSeen = now;
		} else {
			this.state.nodes[key] = { name: key, frequency: 1, lastSeen: now };
		}
	}

	/**
	 * Strengthen the association between two entities (Hebbian learning).
	 * "Neurons that fire together wire together."
	 *
	 * Uses NPMI-inspired normalization to prevent high-frequency entities
	 * from dominating associations.
	 */
	strengthen(
		entityA: string,
		entityB: string,
		boost = 0.1,
		now = Date.now(),
	): void {
		const a = normalize(entityA);
		const b = normalize(entityB);
		if (a === b) return;

		this.touchNode(a, now);
		this.touchNode(b, now);

		const key = edgeKey(a, b);
		const existing = this.state.edges[key];

		if (existing) {
			existing.coOccurrences++;
			// Diminishing returns: each co-occurrence adds less weight
			const diminishing = boost / Math.sqrt(existing.coOccurrences);
			existing.weight = Math.min(1.0, existing.weight + diminishing);
		} else {
			this.state.edges[key] = {
				from: a < b ? a : b,
				to: a < b ? b : a,
				weight: boost,
				coOccurrences: 1,
			};
		}
	}

	/**
	 * Spreading activation from a seed set of entities.
	 *
	 * Activates seed entities, then propagates activation along
	 * weighted edges. Returns entities ranked by activation level.
	 *
	 * @param seeds - Starting entities
	 * @param depth - How many hops to spread (default: 2)
	 * @param decayFactor - Activation decay per hop (default: 0.8 - R4 #220)
	 * @returns Entities sorted by activation level (excluding seeds)
	 */
	spreadingActivation(
	        seeds: string[],
	        depth = 2,
	        decayFactor = 0.8,
	): Array<{ entity: string; activation: number }> {		const activation = new Map<string, number>();
		const seedSet = new Set(seeds.map(normalize));

		// Initialize seeds with activation 1.0
		for (const seed of seedSet) {
			if (this.state.nodes[seed]) {
				activation.set(seed, 1.0);
			}
		}

		// Spread for each depth level
		for (let d = 0; d < depth; d++) {
			const currentActivations = new Map(activation);

			for (const [entity, level] of currentActivations) {
				if (level <= 0.01) continue; // Skip negligible activations

				// Find all edges connected to this entity
				const neighbors = this.getNeighbors(entity);
				for (const { neighbor, weight } of neighbors) {
					const spreadAmount = level * weight * decayFactor;
					const current = activation.get(neighbor) ?? 0;
					activation.set(neighbor, Math.max(current, spreadAmount));
				}
			}
		}

		// Return non-seed entities sorted by activation
		return Array.from(activation.entries())
			.filter(([entity]) => !seedSet.has(entity))
			.map(([entity, act]) => ({ entity, activation: act }))
			.filter((x) => x.activation > 0.01)
			.sort((a, b) => b.activation - a.activation);
	}

	/**
	 * Get all neighbors of an entity with their edge weights.
	 */
	getNeighbors(entity: string): Array<{ neighbor: string; weight: number }> {
		const key = normalize(entity);
		const result: Array<{ neighbor: string; weight: number }> = [];

		for (const edge of Object.values(this.state.edges)) {
			if (edge.from === key) {
				result.push({ neighbor: edge.to, weight: edge.weight });
			} else if (edge.to === key) {
				result.push({ neighbor: edge.from, weight: edge.weight });
			}
		}

		return result.sort((a, b) => b.weight - a.weight);
	}

	/**
	 * Decay all edge weights (Ebbinghaus on associations). **R3 보존 우선(#25): edge 를 삭제하지 않는다** —
	 * pruneThreshold 미만이어도 weight 만 약화하고 영구 보존(spreading activation 에서 weight≈0 은 자연 무시,
	 * 효과 0). 임계 도달(#29) 시에만 explicit forget 가능. ⚠️ 과거 JSDoc 은 "Removes edges / Number of edges
	 * removed" 로 *거짓 기술* 했었음(적대검증 2026-06-21) — 실제로는 무삭제.
	 *
	 * @returns pruneThreshold 미만으로 *약화된*(삭제 아님) edge 수
	 */
	decayEdges(factor = 0.95, pruneThreshold = 0.01): number {
		let weakened = 0;
		for (const [, edge] of Object.entries(this.state.edges)) {
			edge.weight *= factor;
			if (edge.weight < pruneThreshold) weakened++; // 데이터 보존 — weight 매우 약함(recall priority ~0 효과)
		}
		return weakened;
	}

	/**
	 * Get the top-N most connected entities.
	 */
	getHubs(
		topN = 10,
	): Array<{ entity: string; connectionCount: number; totalWeight: number }> {
		const entityWeights = new Map<string, { count: number; weight: number }>();

		for (const edge of Object.values(this.state.edges)) {
			for (const entity of [edge.from, edge.to]) {
				const existing = entityWeights.get(entity) ?? { count: 0, weight: 0 };
				existing.count++;
				existing.weight += edge.weight;
				entityWeights.set(entity, existing);
			}
		}

		return Array.from(entityWeights.entries())
			.map(([entity, { count, weight }]) => ({
				entity,
				connectionCount: count,
				totalWeight: weight,
			}))
			.sort((a, b) => b.totalWeight - a.totalWeight)
			.slice(0, topN);
	}

	/** Get graph stats */
	get stats(): { nodeCount: number; edgeCount: number } {
		return {
			nodeCount: Object.keys(this.state.nodes).length,
			edgeCount: Object.keys(this.state.edges).length,
		};
	}
}
