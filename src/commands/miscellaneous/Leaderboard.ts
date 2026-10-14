import { Reputation } from "@/mongo";
import type { DiscordClient } from "@/registry/DiscordClient";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "@/registry/Structure/BaseCommand";
import { PaginationBuilder } from "@discordforge/pagination";
import {
	ApplicationIntegrationType,
	Colors,
	DiscordAPIError,
	InteractionContextType,
	MessageFlags,
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
				)
				// Optional; when omitted, the leaderboard only includes current server members.
				.addBooleanOption((option) =>
					option
						.setName("all_members")
						.setDescription(
							"Include users who are no longer in the server.",
						)
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
		const allMembers =
			interaction.options.getBoolean("all_members", false) ?? false;

		await interaction.deferReply();

		const reps = await Reputation.find({
			guildId: interaction.guildId,
		}).sort({
			rep: -1,
			userId: 1,
		});

		const visibleReps = allMembers ? reps : [];
		if (!allMembers) {
			// limit lookups to avoid spamming API 
			for (let i = 0; i < reps.length; i += 25) {
				const batch = await Promise.all(
					reps.slice(i, i + 25).map(async (rep) => {
						if (interaction.guild.members.cache.has(rep.userId))
							return rep;

						try {
							await interaction.guild.members.fetch(rep.userId);
							return rep;
						} catch (error) {
							if (
								error instanceof DiscordAPIError &&
								error.code === 10007
							)
								// unknown member, return null
								return null;

							throw error;
						}
					}),
				);

				visibleReps.push(
					...batch.filter(
						(rep): rep is (typeof reps)[number] => rep !== null,
					),
				);
			}
		}

		if (visibleReps.length === 0) {
			interaction.followUp({
				content: "No one in this server has rep 💀",
				flags: MessageFlags.Ephemeral,
			});

			return;
		}

		new PaginationBuilder(
			visibleReps.map(({ userId, rep }) => ({ userId, rep })),
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
