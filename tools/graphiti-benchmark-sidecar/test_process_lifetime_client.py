import asyncio
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from graph_service import zep_graphiti


class FakeClient:
    def __init__(self):
        self.build_calls = 0
        self.close_calls = 0

    async def build_indices_and_constraints(self):
        self.build_calls += 1

    async def close(self):
        self.close_calls += 1


class ProcessLifetimeClientTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        zep_graphiti._graphiti_client = None

    def tearDown(self):
        zep_graphiti._graphiti_client = None

    async def test_startup_constructs_off_loop_reuses_and_closes_once(self):
        client = FakeClient()
        create_threads = []
        event_loop_thread = threading.get_ident()

        def create_client(_settings):
            create_threads.append(threading.get_ident())
            with self.assertRaises(RuntimeError):
                asyncio.get_running_loop()
            return client

        with (
            patch.object(zep_graphiti, '_create_graphiti_client', create_client),
            patch.object(zep_graphiti, '_configure_graphiti_client'),
        ):
            settings = SimpleNamespace()
            await zep_graphiti.initialize_graphiti(settings)
            await zep_graphiti.initialize_graphiti(settings)

            self.assertEqual(len(create_threads), 1)
            self.assertNotEqual(create_threads[0], event_loop_thread)
            self.assertEqual(client.build_calls, 1)

            first_dependency = zep_graphiti.get_graphiti(settings)
            second_dependency = zep_graphiti.get_graphiti(settings)
            self.assertIs(await anext(first_dependency), client)
            self.assertIs(await anext(second_dependency), client)
            await first_dependency.aclose()
            await second_dependency.aclose()
            self.assertEqual(client.close_calls, 0)

            await zep_graphiti.close_graphiti()
            await zep_graphiti.close_graphiti()
            self.assertEqual(client.close_calls, 1)

            unavailable_dependency = zep_graphiti.get_graphiti(settings)
            with self.assertRaisesRegex(HTTPException, 'Graphiti is not initialized'):
                await anext(unavailable_dependency)

    async def test_startup_failure_closes_client_and_is_not_published(self):
        client = FakeClient()

        async def fail_build():
            client.build_calls += 1
            raise RuntimeError('index initialization failed')

        client.build_indices_and_constraints = fail_build
        with (
            patch.object(zep_graphiti, '_create_graphiti_client', return_value=client),
            patch.object(zep_graphiti, '_configure_graphiti_client'),
        ):
            with self.assertRaisesRegex(RuntimeError, 'index initialization failed'):
                await zep_graphiti.initialize_graphiti(SimpleNamespace())

        self.assertEqual(client.build_calls, 1)
        self.assertEqual(client.close_calls, 1)
        self.assertIsNone(zep_graphiti._graphiti_client)


if __name__ == '__main__':
    unittest.main()
