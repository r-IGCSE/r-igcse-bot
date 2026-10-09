import { ReputationData, Reputation } from "@/mongo";
import type { DiscordClient } from "@/registry/DiscordClient";
import {
	ApplicationIntegrationType,
	Colors,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	InteractionContextType,
	SlashCommandBuilder,
	ButtonStyle,
    PermissionFlagsBits,
} from "discord.js";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "../../registry/Structure/BaseCommand";
import { v4 as uuidv4 } from "uuid";

export default class ReputationTestCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("rep_test")
				.setDescription("View someone's reputation")
				.addSubcommand((subcommand) =>
					subcommand
						.setName("view")
						.setDescription("View someone's reputation")
						.addUserOption((option) =>
							option
								.setName("user")
								.setDescription("The user to view the rep of")
								.setRequired(false),
						),
				)
                .setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
		);
	}

	async execute(
		client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction<"cached">,
	) {

		await interaction.deferReply();

		const user =
			interaction.options.getUser("user", false) ?? interaction.user;

		const res = await Reputation.findOne({
			guildId: interaction.guild.id,
			userId: user.id,
		});
		
		const allTime = res?.rep || 0;

		const leaderboardRank = (
			await Reputation.countDocuments({
				guildId: interaction.guildId,
				$or: [
					// check if the record has more reputation than this user
					{ rep: { $gt: allTime } },
					// record has the same reputation but user id is before, so it wins tie breaker
					{ rep: allTime, userId: { $lt: user.id } },
				]	
			})
		) + 1;

		const now = Date.now();
		const baseFilter = {
			guildId: interaction.guild.id,
			reppedUser: user.id,
			deleted: { $ne: true },
		};
		const countSince = (duration: number) =>
			ReputationData.countDocuments({
				...baseFilter,
				when: { $gte: new Date(now - duration) },
			});

		const [
			lastDay,
			lastWeek,
			last30Days,
			last60Days,
			last180Days,
			last365Days,
			topChannels,
		] = await Promise.all([
			countSince(24 * 60 * 60 * 1000),
			countSince(7 * 24 * 60 * 60 * 1000),
			countSince(30 * 24 * 60 * 60 * 1000),
			countSince(60 * 24 * 60 * 60 * 1000),
			countSince(180 * 24 * 60 * 60 * 1000),
			countSince(365 * 24 * 60 * 60 * 1000),
			ReputationData.aggregate<{ _id: string; rep: number }>([
				{ $match: baseFilter },
				{ $group: { _id: "$channelId", rep: { $sum: 1 } } },
				{ $sort: { rep: -1, _id: 1 } },
				{ $limit: 5 },
			]),
		]);

		const repEmbed = new EmbedBuilder()
			.setDescription(
				[
					`### :star: Reputation Statistics\n <@${user.id}> has **${allTime}** reputation.\n-# Ranked **#${leaderboardRank}** on the leaderboard.\n### :clipboard: **Top Channels**`,
					...(topChannels.length
						? topChannels.map(
								({ _id, rep }, index) =>
									`${index + 1}. <#${_id}>: ${rep}`,
							)
						: ["No channel data yet."]),
				].join("\n"),
			)
			.addFields([
				{ name: "Last 24h", value: `${lastDay}`, inline: true },
				{ name: "Last 7d", value: `${lastWeek}`, inline: true },
				{ name: "Last 30d", value: `${last30Days}`, inline: true },
				//{ name: "Last 60d", value: `${last60Days}`, inline: true },
				//{ name: "Last 180d", value: `${last180Days}`, inline: true },
			])
			.setColor(Colors.Blurple);

		const customId = uuidv4();

		const repStatsButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder({
				customId: `${customId}_advancedStats`,
				label: "More Statistics",
				style: ButtonStyle.Secondary,
			})
		);

		const response = await interaction.editReply({
			embeds: [repEmbed],
			components: [repStatsButton],
		});

		let buttonInteraction;

		try {
			buttonInteraction = await response.awaitMessageComponent({
				time: 1_800_000,
				filter: (repStatsButton) => repStatsButton.user.id === interaction.user.id,
			});
		} catch (error) {
			await interaction.editReply({
				content: "Error occured, please try again.",
				embeds: [],
				components: [],
			});
			return;
		}

		if (buttonInteraction.customId.endsWith("_advancedStats")) {
			const updatedRepEmbed = new EmbedBuilder()
			.setDescription(
				[
					`### :star: Reputation Statistics\n <@${user.id}> has **${allTime}** reputation.\n### :clipboard: **Top Channels**`,
					...(topChannels.length
						? topChannels.map(
								({ _id, rep }, index) =>
									`${index + 1}. <#${_id}>: ${rep}`,
							)
						: ["No channel data yet."]),
				].join("\n"),
			)
			.addFields([
				{ name: "Last 24h", value: `${lastDay}`, inline: true },
				{ name: "Last 7d", value: `${lastWeek}`, inline: true },
				{ name: "Last 30d", value: `${last30Days}`, inline: true },
				{ name: "Last 60d", value: `${last60Days}`, inline: true },
				{ name: "Last 6 Months", value: `${last180Days}`, inline: true },
				{ name: "Last 12 Months", value: `${last365Days}`, inline: true },
			])
			.setColor(Colors.Blurple);

			await buttonInteraction.update({
				embeds: [updatedRepEmbed],
				components: [],
			});
		}
	}
}
