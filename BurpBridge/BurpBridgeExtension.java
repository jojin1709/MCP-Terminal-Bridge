package burpbridge;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.HttpService;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;
import burp.api.montoya.proxy.ProxyHttpRequestResponse;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.stream.Collectors;

public class BurpBridgeExtension implements BurpExtension {

    private static final int PORT = 9876;
    private MontoyaApi api;
    private final Gson gson = new Gson();

    @Override
    public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("BurpBridge (MCP)");

        try {
            HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
            server.createContext("/proxy/history", this::handleProxyHistory);
            server.createContext("/repeater/send", this::handleRepeaterSend);
            server.createContext("/repeater/open", this::handleRepeaterOpen);
            server.createContext("/intruder/open", this::handleIntruderOpen);
            server.createContext("/sitemap", this::handleSitemap);
            server.createContext("/scope/add", this::handleScopeAdd);
            server.createContext("/scope/check", this::handleScopeCheck);
            server.setExecutor(null);
            server.start();
            api.logging().logToOutput("BurpBridge listening on 127.0.0.1:" + PORT);
        } catch (IOException e) {
            api.logging().logToError("BurpBridge failed to start: " + e.getMessage());
        }
    }

    private void handleProxyHistory(HttpExchange ex) throws IOException {
        List<ProxyHttpRequestResponse> history = api.proxy().history();
        int limit = Math.min(history.size(), 200);
        List<JsonObject> out = new ArrayList<>();
        for (int i = history.size() - limit; i < history.size(); i++) {
            ProxyHttpRequestResponse item = history.get(i);
            HttpRequest req = item.request();
            HttpResponse res = item.response();
            JsonObject o = new JsonObject();
            o.addProperty("url", req.url());
            o.addProperty("method", req.method());
            o.addProperty("status", res != null ? res.statusCode() : -1);
            o.addProperty("requestB64", b64(req.toByteArray().getBytes()));
            o.addProperty("responseB64", res != null ? b64(res.toByteArray().getBytes()) : "");
            out.add(o);
        }
        sendJson(ex, 200, gson.toJson(out));
    }

    private void handleRepeaterSend(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) {
            sendJson(ex, 405, "{\"error\":\"POST only\"}");
            return;
        }
        JsonObject body = gson.fromJson(readBody(ex), JsonObject.class);
        String url = body.has("url") ? body.get("url").getAsString() : null;
        String rawB64 = body.has("raw") ? body.get("raw").getAsString() : null;

        try {
            HttpRequest request;
            if (rawB64 != null && !rawB64.isEmpty()) {
                byte[] raw = Base64.getDecoder().decode(rawB64);
                HttpService service = HttpService.httpService(url);
                request = HttpRequest.httpRequest(service, burp.api.montoya.core.ByteArray.byteArray(raw));
            } else {
                request = HttpRequest.httpRequestFromUrl(url);
            }
            HttpRequestResponse result = api.http().sendRequest(request);
            HttpResponse response = result.response();
            JsonObject o = new JsonObject();
            o.addProperty("status", response != null ? response.statusCode() : -1);
            o.addProperty("responseB64", response != null ? b64(response.toByteArray().getBytes()) : "");
            sendJson(ex, 200, gson.toJson(o));
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.getMessage()) + "\"}");
        }
    }

    private void handleRepeaterOpen(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) {
            sendJson(ex, 405, "{\"error\":\"POST only\"}");
            return;
        }
        JsonObject body = gson.fromJson(readBody(ex), JsonObject.class);
        String url = body.has("url") ? body.get("url").getAsString() : null;
        String rawB64 = body.has("raw") ? body.get("raw").getAsString() : null;
        String tabName = body.has("tabName") ? body.get("tabName").getAsString() : "MCP";

        try {
            HttpRequest request;
            if (rawB64 != null && !rawB64.isEmpty()) {
                byte[] raw = Base64.getDecoder().decode(rawB64);
                HttpService service = HttpService.httpService(url);
                request = HttpRequest.httpRequest(service, burp.api.montoya.core.ByteArray.byteArray(raw));
            } else {
                request = HttpRequest.httpRequestFromUrl(url);
            }
            api.repeater().sendToRepeater(request, tabName);
            sendJson(ex, 200, "{\"ok\":true,\"tabName\":\"" + esc(tabName) + "\"}");
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.getMessage()) + "\"}");
        }
    }

    private void handleIntruderOpen(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) {
            sendJson(ex, 405, "{\"error\":\"POST only\"}");
            return;
        }
        JsonObject body = gson.fromJson(readBody(ex), JsonObject.class);
        String url = body.has("url") ? body.get("url").getAsString() : null;
        String rawB64 = body.has("raw") ? body.get("raw").getAsString() : null;

        try {
            HttpRequest request;
            if (rawB64 != null && !rawB64.isEmpty()) {
                byte[] raw = Base64.getDecoder().decode(rawB64);
                HttpService service = HttpService.httpService(url);
                request = HttpRequest.httpRequest(service, burp.api.montoya.core.ByteArray.byteArray(raw));
            } else {
                request = HttpRequest.httpRequestFromUrl(url);
            }
            // Note: Burp's public extension API only supports opening a request in
            // Intruder for the user to configure payload positions and launch manually.
            // There is no API to configure payload sets / attack type / start the
            // attack programmatically, or to read results back out.
            api.intruder().sendToIntruder(request);
            sendJson(ex, 200, "{\"ok\":true,\"note\":\"Opened in Intruder - configure payload positions and click Start manually in Burp\"}");
        } catch (Exception e) {
            sendJson(ex, 500, "{\"error\":\"" + esc(e.getMessage()) + "\"}");
        }
    }

    private void handleSitemap(HttpExchange ex) throws IOException {
        var items = api.siteMap().requestResponses();
        int limit = Math.min(items.size(), 500);
        List<JsonObject> out = new ArrayList<>();
        for (int i = 0; i < limit; i++) {
            var item = items.get(i);
            JsonObject o = new JsonObject();
            o.addProperty("url", item.request().url());
            o.addProperty("method", item.request().method());
            out.add(o);
        }
        sendJson(ex, 200, gson.toJson(out));
    }

    private void handleScopeAdd(HttpExchange ex) throws IOException {
        JsonObject body = gson.fromJson(readBody(ex), JsonObject.class);
        String url = body.get("url").getAsString();
        api.scope().includeInScope(url);
        sendJson(ex, 200, "{\"ok\":true}");
    }

    private void handleScopeCheck(HttpExchange ex) throws IOException {
        String query = ex.getRequestURI().getQuery();
        String url = (query != null && query.startsWith("url="))
                ? URLDecoder.decode(query.substring(4), StandardCharsets.UTF_8)
                : "";
        boolean inScope = api.scope().isInScope(url);
        sendJson(ex, 200, "{\"inScope\":" + inScope + "}");
    }

    private String readBody(HttpExchange ex) throws IOException {
        return new BufferedReader(new InputStreamReader(ex.getRequestBody(), StandardCharsets.UTF_8))
                .lines().collect(Collectors.joining("\n"));
    }

    private void sendJson(HttpExchange ex, int code, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    private String b64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }

    private String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
