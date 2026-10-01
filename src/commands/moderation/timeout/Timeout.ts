import { Punishment } from "@/mongo";
import { GuildPreferencesCache, InfractionsCache } from "@/redis";
import type { DiscordClient } from "@/registry/DiscordClient";
import { Logger } from "@discordforge/logger";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "@/registry/Structure/BaseCommand";
import { logToChannel } from "@/utils/Logger";
import sendDm from "@/utils/sendDm";
import {
	Colors,
	EmbedBuilder,
	PermissionFlagsBits,
	MessageFlags,
	SlashCommandBuilder,
    ApplicationIntegrationType,
    InteractionContextType,
	type AutocompleteInteraction,
} from "discord.js";
import humanizeDuration from "humanize-duration";
import parse from "parse-duration";
import { infractionAutoComplete } from "../infractionAutoComplete";

export default class TimeoutCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("timeout")
				.setDescription("Timeout a user (for mods)")
				.addUserOption((option) =>
					option
						.setName("user")
						.setDescription("User to timeout")
						.setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName("duration")
						.setDescription("Duration for timeout (from now)")
						.setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName("reason")
						.setDescription("Reason for timeout")
						.setRequired(true)
						.setAutocomplete(true),
				)
				.setDefaultMemberPermissions(
					PermissionFlagsBits.ModerateMembers,
				)
				.setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
		);
	}

	async execute(
		client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction<"cached">,
	) {
		if (!interaction.channel || !interaction.channel.isTextBased()) return;

		const user = interaction.options.getUser("user", true);
		const reason = interaction.options.getString("reason", true);
		const durationString = interaction.options.getString("duration", true);

		await interaction.deferReply({
			flags: MessageFlags.Ephemeral,
		});

		const guildPreferences = await GuildPreferencesCache.get(
			interaction.guildId,
		);

		if (!guildPreferences) {
			interaction.editReply({
				content:
					"Please setup the bot using the command `/setup` first.",
			});
			return;
		}

		const duration = ["unspecified", "permanent", "undecided"].some((s) =>
			durationString.includes(s),
		)
			? 2419200
			: (parse(durationString, "second") ?? 86400);

		if (duration < 60 || duration > 2419200) {
			const error = new EmbedBuilder()
				.setTitle(":lock: What are you doing?")
				.setDescription("Timeout duration must be between 60 seconds and 28 days.")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		const guildMember = await interaction.guild.members.fetch(user.id);

		if (!guildMember) {
			const error = new EmbedBuilder()
				.setTitle(":question: Not Found")
				.setDescription("I was not able to find the user in this server, they may have left or are not a member. Please re-check the User ID.")
				.setTimestamp()
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		if (guildMember.id === interaction.user.id) {
			const error = new EmbedBuilder()
				.setTitle(":lock: What are you doing?")
				.setDescription("You cannot timeout yourself, Consider a bit of grass?")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		const memberHighestRole = guildMember.roles.highest;
		const modHighestRole = interaction.member.roles.highest;

		// member role is higher than the moderators role
		// ensure that server owners bypass this check
		if (memberHighestRole.comparePositionTo(modHighestRole) >= 0 && (interaction.user.id !== interaction.guild.ownerId)) {
			const error = new EmbedBuilder()
				.setTitle(":lock: No Permission")
				.setDescription("You are not allowed to timeout this user as their role is higher than or equal to yours.")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		const latestTimeout = (
			await Punishment.find({
				guildId: interaction.guildId,
				actionAgainst: guildMember.id,
				action: "Timeout",
			}).sort({ when: -1 })
		)[0];

		const punishments = await Punishment.find({
			guildId: interaction.guildId,
			actionAgainst: user.id,
		}).sort({ when: 1 });

		const points = duration >= 604800 ? 4 : duration >= 21600 ? 3 : 2;

		let totalPoints = points;

		for (const { points } of punishments) {
			if (points) totalPoints += points;
		}

		if (
			guildMember.isCommunicationDisabled() &&
			latestTimeout?.duration &&
			latestTimeout.when.getTime() + latestTimeout.duration * 1000 >
				Date.now()
		) {
			const newEndTime = Date.now() + duration * 1000;

			const time = Math.floor(newEndTime / 1000);

			sendDm(guildMember, {
				embeds: [
					new EmbedBuilder()
						.setTitle(":mute: Timeout Modified")
						.setColor(Colors.Red)
						.setTimestamp()
						.setDescription(
							`Your timeout in **${
								interaction.guild.name
								}** due to due to \`${reason}\` has been modified to last ${humanizeDuration(
								duration * 1000,
							)} from now. Your timeout will end <t:${time}:R>.`,
						),
				],
			});

			try {
				await guildMember.timeout(duration * 1000, reason);
			} catch (error) {
				interaction.editReply({
					content: `Failed to update user timeout duration ${
						error instanceof Error ? `(${error.message})` : ""
					}`,
				});

				client.log(
					error,
					`${this.data.name} Command (change duration)`,
					`**Channel:** <#${interaction.channel?.id}>
						**User:** <@${interaction.user.id}>
						**Guild:** ${interaction.guild.name} (${interaction.guildId})\n`,
				);

				return;
			}

			const previousReason = latestTimeout.reason;

			await latestTimeout.updateOne({
				actionBy: interaction.user.id,
				reason: `${previousReason}, ${reason}`,
				duration: duration,
				points: duration >= 604800 ? 4 : duration >= 21600 ? 3 : 2,
			});

			const modEmbed = new EmbedBuilder()
				.setTitle(
					`:mute: Timeout Duration Modified | Case #${latestTimeout.caseId}`,
				)
				.setColor(Colors.Red)
				.addFields([
					{
						name: "User",
						value: `${user.tag} (${user.id})`,
						inline: false,
					},
					{
						name: "Moderator",
						value: `${interaction.user.tag} (${interaction.user.id})`,
						inline: false,
					},
					{
						name: "Reason",
						value: reason,
					},
					{
						name: "Duration",
						value: `${humanizeDuration(duration * 1000)} (<t:${time}:R>)`,
					},
				]);

			if (guildPreferences.modlogChannelId) {
				logToChannel(
					interaction.guild,
					guildPreferences.modlogChannelId,
					{
						embeds: [modEmbed],
					},
				);
			}

			interaction.editReply({
				content: `changed user's timeout duration rahhhhhh \nthey have ${totalPoints} points`,
			});
			interaction.channel.send(
				`:mute: ${user.username}'s timeout has been modified due to *${reason}*, it will end at <t:${time}:f>. (<t:${time}:R>)`,
			);
			return;
		}

		try {
			await guildMember.timeout(duration * 1000, reason);
			sendDm(guildMember, {
				embeds: [
					new EmbedBuilder()
						.setTitle(":mute: Timeout")
						.setColor(Colors.Red)
						.setTimestamp()
						.setDescription(
							`You have been timed out in **${interaction.guild.name}** for ${humanizeDuration(duration * 1000)} due to: \`${reason}\`. Your timeout will end <t:${Math.floor(Date.now() / 1000) + duration}:R>.`,
						),
				],
			});
		} catch (error) {
			interaction.editReply({
				content: `Failed to timeout user ${
					error instanceof Error ? `(${error.message})` : ""
				}`,
			});

			client.log(
				error,
				`${this.data.name} Command`,
				`**Channel:** <#${interaction.channel?.id}>
						**User:** <@${interaction.user.id}>
						**Guild:** ${interaction.guild.name} (${interaction.guildId})\n`,
			);

			return;
		}

		const caseNumber =
			(
				await Punishment.find({
					guildId: interaction.guildId,
				})
			).length + 1;

		Punishment.create({
			guildId: interaction.guild.id,
			actionAgainst: user.id,
			actionBy: interaction.user.id,
			action: "Timeout",
			caseId: caseNumber,
			duration,
			reason,
			points,
			when: new Date(),
		});

		const modEmbed = new EmbedBuilder()
			.setTitle(`Timeout | Case #${caseNumber}`)
			.setColor(Colors.Red)
			.setThumbnail(user.displayAvatarURL())
			.setTimestamp()
			.addFields([
				{
					name: "User",
					value: `${user.tag} (${user.id})`,
					inline: false,
				},
				{
					name: "Moderator",
					value: `${interaction.user.tag} (${interaction.user.id})`,
					inline: false,
				},
				{
					name: "Reason",
					value: reason,
				},
				{
					name: "Duration",
					value: `${humanizeDuration(duration * 1000)} (<t:${
						Math.floor(Date.now() / 1000) + duration
					}:R>)`,
				},
			]);

		if (guildPreferences.modlogChannelId) {
			logToChannel(interaction.guild, guildPreferences.modlogChannelId, {
				embeds: [modEmbed],
			});
		}

		const timeoutReply = new EmbedBuilder()
			.setTitle("Infraction Points")
			.setColor(Colors.Blurple)
			.setDescription(`<@${user.id}> is now at ${totalPoints} points.`);

		await interaction.editReply({
			embeds: [timeoutReply],
			components: [],
		});

		const time = Math.floor(Date.now() / 1000 + duration);
		interaction.channel.send(
			`:mute: ${user.username} has been timed out for *${reason}* until <t:${time}:f>. (<t:${time}:R>) (Case #${caseNumber})`,
		);
	}

	async autoComplete(interaction: AutocompleteInteraction) {
			await infractionAutoComplete(interaction);
		}
}