import { Reputation } from "@/mongo";
import type { DiscordClient } from "@/registry/DiscordClient";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "@/registry/Structure/BaseCommand";
import { PaginationBuilder } from "@discordforge/pagination";
import {
	ApplicationIntegrationType,
	Colors,
	InteractionContextType,
	MessageFlags,
	Message,
	SlashCommandBuilder,
} from "discord.js";

export default class LeaderboardCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("leaderboard")
				.setDescription("View the current rep leaderboard")
				.setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
				.addIntegerOption((option) =>
					option
						.setName("page")
						.setDescription("Page number to to display")
						.setRequired(false),
				),
		);
	}

	async execute(
		client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction<"cached">,
	) {
		if (!interaction.channel || !interaction.channel.isTextBased()) return;

		const page = (interaction.options.getInteger("page", false) ?? 1) - 1;

		await interaction.deferReply();

		const reps = await Reputation.find({
			guildId: interaction.guildId,
		}).sort({
			rep: "descending",
		});

		if (reps.length === 0) {
			interaction.followUp({
				content: "No one in this server has rep 💀",
				flags: MessageFlags.Ephemeral,
			});

			return;
		}

		new PaginationBuilder(
			reps.map(({ userId, rep }) => ({ userId, rep })),
			async ({ userId, rep }) => ({
				name: (await client.users.fetch(userId)).tag,
				value: `${rep}`,
				inline: true,
			}),
		)
			.setTitle("Rep Leaderboard")
			.setColor(Colors.Blurple)
			.setInitialPage(page)
			.build((page) => interaction.followUp(page), [interaction.user.id]);
	}
}
