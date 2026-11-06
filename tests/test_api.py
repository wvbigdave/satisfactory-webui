"""The game client stays on loopback and bounds untrusted API responses."""
import io
import json
import unittest
from unittest import mock
from urllib import error, request

from satisfactory_webui import api


class GameClientTests(unittest.TestCase):
    def test_request_is_fixed_loopback_with_bounded_read(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"data": {"health": "healthy"}}'
        with mock.patch.object(api._opener, 'open', return_value=response) as opened:
            self.assertEqual(api.call('HealthCheck')['data']['health'], 'healthy')
        req = opened.call_args.args[0]
        self.assertEqual(req.full_url, 'https://127.0.0.1:7777/api/v1')
        response.read.assert_called_once_with(api.MAX_RESPONSE_BYTES + 1)

    def test_non_object_and_oversized_responses_fail_safely(self):
        for body in (b'[]', b'null', b'{' , b'x' * (api.MAX_RESPONSE_BYTES + 1)):
            response = mock.MagicMock()
            response.__enter__.return_value = response
            response.read.return_value = body
            with mock.patch.object(api._opener, 'open', return_value=response):
                ok, result = api.safe_call('HealthCheck')
            self.assertFalse(ok)
            self.assertIn('error', result)

    def test_redirect_is_rejected_instead_of_leaving_loopback(self):
        redirect = api._NoRedirect()
        with self.assertRaises(error.HTTPError) as raised:
            redirect.redirect_request(request.Request(api.API), io.BytesIO(), 302,
                                      'redirect', {}, 'https://example.invalid/')
        raised.exception.close()

    def test_environment_proxies_are_disabled(self):
        # An empty ProxyHandler installs no per-scheme proxy handlers.
        self.assertFalse(any(isinstance(handler, request.ProxyHandler)
                             for handler in api._opener.handlers))

    def test_optional_token_is_sent_as_a_header_not_in_the_url(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{}'
        with mock.patch.dict(api.os.environ, {'SATISFACTORY_API_TOKEN': 'fixture-token'}), \
                mock.patch.object(api._opener, 'open', return_value=response) as opened:
            api.call('HealthCheck')
        req = opened.call_args.args[0]
        self.assertEqual(req.get_header('Authorization'), 'Bearer fixture-token')
        self.assertNotIn('fixture-token', req.full_url)

    def test_non_object_error_is_normalized_and_closed(self):
        body = io.BytesIO(json.dumps(['error']).encode())
        response = error.HTTPError(api.API, 400, 'bad request', {}, body)
        with mock.patch.object(api, 'call', side_effect=response):
            ok, result = api.safe_call('HealthCheck')
        self.assertFalse(ok)
        self.assertIsInstance(result, dict)
        self.assertTrue(body.closed)
