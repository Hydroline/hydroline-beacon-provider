package com.hydroline.beacon.provider.forge;

import com.hydroline.beacon.provider.BeaconProviderMod;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

/**
 * Forge bootstrap that wires shared logic and keeps room for Forge-only hooks.
 */
@Mod(BeaconProviderMod.MOD_ID)
public final class BeaconProviderForge {
    public BeaconProviderForge() {
        BeaconProviderMod.init();
        IEventBus modBus = FMLJavaModLoadingContext.get().getModEventBus();
        modBus.addListener(this::onCommonSetup);
    }

    private void onCommonSetup(final FMLCommonSetupEvent event) {
        // Register Forge specifics here when needed.
    }
}
