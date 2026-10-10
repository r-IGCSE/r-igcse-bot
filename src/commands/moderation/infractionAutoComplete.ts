import { Logger } from "@discordforge/logger";
import { InfractionsCache } from "@/redis";
import type { AutocompleteInteraction } from "discord.js";

// helper function for autocompleting infractions
export async function infractionAutoComplete(
    interaction: AutocompleteInteraction,
): Promise<void> {
    const phrase = interaction.options.getFocused().toString();

    try {
        const reasons = await InfractionsCache.autoComplete(phrase);
        await interaction.respond(
            reasons.slice(0, 25).map((reason) => ({
                name: reason,
                value: reason,
            })),
        );
    } catch (error) {
        Logger.error(error);
        await interaction.respond([]);
    }
}