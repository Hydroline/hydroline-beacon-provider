package com.hydroline.beacon.provider.service.mtr;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.hydroline.beacon.provider.mtr.MtrDimensionSnapshot;
import com.hydroline.beacon.provider.mtr.MtrQueryGateway;
import com.hydroline.beacon.provider.mtr.RailwayDataSerializer;
import com.hydroline.beacon.provider.protocol.BeaconMessage;
import com.hydroline.beacon.provider.protocol.BeaconResponse;
import com.hydroline.beacon.provider.transport.TransportContext;
import java.util.Base64;
import java.util.List;

public final class MtrGetRailwaySnapshotActionHandler extends AbstractMtrActionHandler {
    public static final String ACTION = "mtr:get_railway_snapshot";

    @Override
    public String action() {
        return ACTION;
    }

    @Override
    public BeaconResponse handle(BeaconMessage message, TransportContext context) {
        MtrQueryGateway gateway = gateway();
        if (!gateway.isReady()) {
            return notReady(message.getRequestId());
        }
        JsonObject payload = message.getPayload();
        String requestedDimension = payload != null && payload.has("dimension")
            ? payload.get("dimension").getAsString()
            : null;
        List<MtrDimensionSnapshot> snapshots = gateway.fetchSnapshots();
        JsonArray serialized = new JsonArray();
        long now = System.currentTimeMillis();
        for (MtrDimensionSnapshot snapshot : snapshots) {
            if (requestedDimension != null && !requestedDimension.equals(snapshot.getDimensionId())) {
                continue;
            }
            byte[] data = RailwayDataSerializer.serialize(snapshot);
            if (data.length == 0) {
                continue;
            }
            JsonObject entry = new JsonObject();
            entry.addProperty("dimension", snapshot.getDimensionId());
            entry.addProperty("format", "messagepack");
            entry.addProperty("timestamp", now);
            entry.addProperty("length", data.length);
            entry.addProperty("payload", Base64.getEncoder().encodeToString(data));
            serialized.add(entry);
        }
        if (requestedDimension != null && serialized.size() == 0) {
            return invalidPayload(message.getRequestId(), "unknown dimension");
        }
        JsonObject responsePayload = new JsonObject();
        responsePayload.addProperty("format", "messagepack");
        responsePayload.add("snapshots", serialized);
        return ok(message.getRequestId(), responsePayload);
    }
}
