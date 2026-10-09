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
				.setDescription("View a member's reputation statistics.")
				.addSubcommand((subcommand) =>
					subcommand
						.setName("user")
						.setDescription("View a member's reputation statistics.")
						.addUserOption((option) =>
							option
								.setName("user")
								.setDescription("The user to view. (Leave blank for self)")
								.setRequired(false),
						)
						.addChannelOption((option) =>
							option
								.setName("channel")
								.setDescription("Filter user stats to a channel.")
								.setRequired(false),
						),
				)
				.addSubcommand((subcommand) =>
					subcommand
						.setName("channel")
						.setDescription("View a channel's reputation statistics.")
						.addChannelOption((option) =>
							option
								.setName("channel")
								.setDescription("The channel to view.")
								.setRequired(true),
						),
				)
				.addSubcommand((subcommand) =>
					subcommand
						.setName("server")
						.setDescription("View a server's reputation statistics.")
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

		switch (interaction.options.getSubcommand()) {
			case "user": {
				const user = interaction.options.getUser("user", false) ?? interaction.user;

				// optional channel when viewing /rep user channel
				const channel = interaction.options.getChannel("channel", false);

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
					// filter by channel if specified
					...(channel ? { channelId: channel.id } : {}),
				};

				// used to calculate rep in a single channel only
				const allTimeInChannel = await ReputationData.countDocuments(baseFilter);

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

				let embedDescription;

				// check if channel is specified
				if (channel) {
					embedDescription = `### :star: Reputation Statistics\n <@${user.id}> has **${allTimeInChannel}** reputation in <#${channel.id}>.`
				} else {
					embedDescription = [
							`### :star: Reputation Statistics\n <@${user.id}> has **${allTime}** reputation.\n-# Ranked **#${leaderboardRank}** on the leaderboard.\n### :clipboard: **Top Channels**`,
							...(topChannels.length
								? topChannels.map(
										({ _id, rep }, index) =>
											`${index + 1}. <#${_id}>: ${rep}`,
									)
								: ["No channel data yet."]),
						].join("\n")
				}

				const repEmbed = new EmbedBuilder()
					.setDescription(embedDescription)
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

				let buttonInteraction: Awaited<
					ReturnType<typeof response.awaitMessageComponent>
				>;

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
					.setDescription(embedDescription)
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
				break
			}
			case "channel": {
				const channel = interaction.options.getChannel("channel", true);
				const now = Date.now();
				const baseFilter = {
					guildId: interaction.guild.id,
					channelId: channel.id,
					deleted: { $ne: true },
				};
				const countSince = (duration: number) =>
					ReputationData.countDocuments({
						...baseFilter,
						when: { $gte: new Date(now - duration) },
					});

				const [
					allTime,
					lastDay,
					lastWeek,
					last30Days,
					last60Days,
					last180Days,
					last365Days,
				] = await Promise.all([
					ReputationData.countDocuments(baseFilter),
					countSince(24 * 60 * 60 * 1000),
					countSince(7 * 24 * 60 * 60 * 1000),
					countSince(30 * 24 * 60 * 60 * 1000),
					countSince(60 * 24 * 60 * 60 * 1000),
					countSince(180 * 24 * 60 * 60 * 1000),
					countSince(365 * 24 * 60 * 60 * 1000),
				]);

				const channelEmbed = new EmbedBuilder()
					.setDescription(
						`### :star: Reputation Statistics\n**${allTime}** reputation has been gained in <#${channel.id}> in total.`,
					)
					.addFields([
						{ name: "Last 24h", value: `${lastDay}`, inline: true },
						{ name: "Last 7d", value: `${lastWeek}`, inline: true },
						{ name: "Last 30d", value: `${last30Days}`, inline: true },
					])
					.setColor(Colors.Blurple);

				const customId = uuidv4();
				const channelStatsButton =
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder({
							customId: `${customId}_advancedStats`,
							label: "More Statistics",
							style: ButtonStyle.Secondary,
						}),
					);

				const response = await interaction.editReply({
					embeds: [channelEmbed],
					components: [channelStatsButton],
				});

				let buttonInteraction: Awaited<
					ReturnType<typeof response.awaitMessageComponent>
				>;
				try {
					buttonInteraction = await response.awaitMessageComponent({
						time: 1_800_000,
						filter: (button) => button.user.id === interaction.user.id,
					});
				} catch {
					await interaction.editReply({
						content: "Error occured, please try again.",
						embeds: [],
						components: [],
					});
					return;
				}

				if (buttonInteraction.customId.endsWith("_advancedStats")) {
					const updatedChannelEmbed = new EmbedBuilder()
						.setDescription(
							`### :star: Reputation Statistics\n**${allTime}** reputation has been gained in <#${channel.id}> in total.`,
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
						embeds: [updatedChannelEmbed],
						components: [],
					});
				}
				break
			}
			case "server": {

				const res = await Reputation.aggregate([
					{ $match: { guildId: interaction.guild.id } },
					{ $group: { _id: null, totalRep: { $sum: "$rep" } } },
				]);

				const allTime = res[0]?.totalRep ?? 0;

				/*
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
				*/

				const now = Date.now();
				const baseFilter = {
					guildId: interaction.guild.id,
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
							`### :star: Reputation Statistics\n **${interaction.guild.name}** has **${allTime}** reputation.\n### :clipboard: **Top Channels**`,
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

				let buttonInteraction: Awaited<
					ReturnType<typeof response.awaitMessageComponent>
				>;

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
							`### :star: Reputation Statistics\n **${interaction.guild.name}** has **${allTime}** reputation.\n### :clipboard: **Top Channels**`,
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
				break
			}
		}
	}
}
