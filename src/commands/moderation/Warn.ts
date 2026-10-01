import { Punishment } from "@/mongo";
import { GuildPreferencesCache, InfractionsCache } from "@/redis";
import { Logger } from "@discordforge/logger";
import type { DiscordClient } from "@/registry/DiscordClient";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "@/registry/Structure/BaseCommand";
import { logToChannel } from "@/utils/Logger";
import sendDm from "@/utils/sendDm";
import {
	Colors,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	MessageFlags,
	InteractionContextType,
	ApplicationIntegrationType,
	type AutocompleteInteraction,
	ButtonStyle,
	ButtonBuilder,
	ActionRowBuilder,
} from "discord.js";
import { v4 as uuidv4 } from "uuid";
import { infractionAutoComplete } from "../moderation/infractionAutoComplete";

export default class WarnCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("warn")
				.setDescription("Warn a user (for mods)")
				.addUserOption((option) =>
					option
						.setName("user")
						.setDescription("User to warn")
						.setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName("reason")
						.setDescription("Reason for warn")
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

		const guildMember = await interaction.guild.members.fetch(user.id);
		const memberHighestRole = guildMember.roles.highest;
		const modHighestRole = interaction.member.roles.highest;

		// defer reply for ephemeral responses
		await interaction.deferReply({
			flags: MessageFlags.Ephemeral,
		});

		
		// member role is higher than the moderators role
		// ensure that server owners bypass this check
		if (memberHighestRole.comparePositionTo(modHighestRole) >= 0 && (interaction.user.id !== interaction.guild.ownerId)) {
			const error = new EmbedBuilder()
				.setTitle(":lock: No Permission")
				.setDescription("You are not allowed to warn this user as their role is higher than or equal to yours.")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}
		

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

		const caseNumber =
			(
				await Punishment.find({
					guildId: interaction.guildId,
				})
			).length + 1;

		interaction.channel.send(
			`:hammer: ${user.username} has been warned for ${reason} (Case #${caseNumber})`,
		);

		await Punishment.create({
			guildId: interaction.guild.id,
			actionAgainst: user.id,
			actionBy: interaction.user.id,
			action: "Warn",
			caseId: caseNumber,
			reason,
			points: 1,
			when: new Date(),
		});

		// send to log channel
		if (guildPreferences.modlogChannelId) {

			const modEmbed = new EmbedBuilder()
				.setTitle(`:exclamation: Warn | Case #${caseNumber}`)
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
				])
				.setThumbnail(user.displayAvatarURL())
				.setTimestamp();
			
			logToChannel(interaction.guild, guildPreferences.modlogChannelId, {
				embeds: [modEmbed],
				components: [],
			});

			
		}

		sendDm(guildMember, {
			embeds: [
				new EmbedBuilder()
					.setTitle(":exclamation: Warning")
					.setColor(Colors.Red)
					.setTimestamp()
					.setDescription(
						`You have been warned in **${interaction.guild.name}** for: \`${reason}\`.`,
					),
			],
		});

		const punishments = await Punishment.find({
			guildId: interaction.guildId,
			actionAgainst: user.id,
		}).sort({ when: 1 });

		let totalPoints = 0;

		for (const { points } of punishments) {
			if (points) totalPoints += points;
		}

		const warnReply = new EmbedBuilder()
			.setTitle("Infraction Points")
			.setColor(Colors.Blurple)
			.setDescription(`<@${user.id}> is now at ${totalPoints} points.`);

		await interaction.editReply({
			embeds: [warnReply],
			components: [],
		});
	}

	async autoComplete(interaction: AutocompleteInteraction) {
		await infractionAutoComplete(interaction);
	}
}