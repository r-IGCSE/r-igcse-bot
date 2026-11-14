import { MessageOptOut } from "@/mongo";
import { MessageOptOutCache } from "@/redis";
import type { DiscordClient } from "@/registry/DiscordClient";
import {
	ApplicationIntegrationType,
	InteractionContextType,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "../../registry/Structure/BaseCommand";

export default class OptOutCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("opt-out")
				.setDescription(
					"Toggle whether the bot processes your messages (opt-out).",
				)
				.setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
		);
	}

	async execute(
		client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction,
	) {
		const optedOut = await MessageOptOut.exists({
			userId: interaction.user.id,
		});

		if (optedOut) {
			await MessageOptOut.deleteOne({
				userId: interaction.user.id,
			});

			// evict so the next check caches the opt-in
			await MessageOptOutCache.remove(interaction.user.id);

			await interaction.reply({
				content:
					"You've opted back in. The bot will process your messages again.",
				flags: MessageFlags.Ephemeral,
			});
		} else {
			await MessageOptOut.create({
				userId: interaction.user.id,
			});

			// warm the cache with the opt-out
			await MessageOptOutCache.set(interaction.user.id, {
				userId: interaction.user.id,
				optedOut: true,
			});

			await interaction.reply({
				content:
					"You've opted out. The bot will no longer process your messages (keywords, counting, sticky pins, reputation and its AI analysis). Use `/opt-out` again to opt back in.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
