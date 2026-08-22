"""Benchmark-only Graphiti routes pinned by pin.json.

Copy this module into Graphiti's ``server/graph_service`` package and include
``router`` in the reference FastAPI app. The service must remain isolated on
loopback because the upstream graph-service has no authentication.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from graphiti_core.edges import EntityEdge
from graphiti_core.errors import GroupsEdgesNotFoundError, NodeNotFoundError
from graphiti_core.nodes import EpisodicNode
from graph_service.zep_graphiti import ZepGraphitiDep


PAGE_SIZE = 1000
router = APIRouter(prefix="/benchmark", tags=["benchmark-companion"])


class EpisodeCommit(BaseModel):
    committed: bool


class NativeFact(BaseModel):
    uuid: str
    fact: str


class CurrentFacts(BaseModel):
    facts: list[NativeFact]


@router.get("/episodes/{group_id}/{episode_uuid}")
async def has_episode(
    group_id: str, episode_uuid: str, graphiti: ZepGraphitiDep
) -> EpisodeCommit:
    try:
        episode = await EpisodicNode.get_by_uuid(graphiti.driver, episode_uuid)
    except NodeNotFoundError:
        return EpisodeCommit(committed=False)
    return EpisodeCommit(committed=episode.group_id == group_id)


@router.get("/current-facts/{group_id}")
async def current_facts(group_id: str, graphiti: ZepGraphitiDep) -> CurrentFacts:
    edges: list[EntityEdge] = []
    cursor: str | None = None
    while True:
        try:
            page = await EntityEdge.get_by_group_ids(
                graphiti.driver,
                [group_id],
                limit=PAGE_SIZE,
                uuid_cursor=cursor,
            )
        except GroupsEdgesNotFoundError:
            break
        edges.extend(page)
        if len(page) < PAGE_SIZE:
            break
        cursor = page[-1].uuid

    # Graphiti marks superseded/terminated edges with expired_at. invalid_at is
    # temporal interval metadata and is therefore not an independent state gate.
    return CurrentFacts(
        facts=[NativeFact(uuid=edge.uuid, fact=edge.fact) for edge in edges if edge.expired_at is None]
    )
