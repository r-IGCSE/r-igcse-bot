import { Reputation } from "@/mongo";
import type { DiscordClient } from "@/registry/DiscordClient";
import {
	ApplicationIntegrationType,
	InteractionContextType,
	SlashCommandBuilder,
} from "discord.js";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "../../registry/Structure/BaseCommand";

export default class ReputationCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("rep")
				.setDescription("View someone's current rep")
				.addSubcommand((subcommand) =>
					subcommand
						.setName("view")
						.setDescription("View someone's current rep")
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
		const user =
			interaction.options.getUser("user", false) ?? interaction.user;

		const res = await Reputation.findOne({
			guildId: interaction.guild.id,
			userId: user.id,
		});

		const rep = res?.rep || 0;

		await interaction.reply({
			content: `${user.username} has ${rep} rep`,
		});
	}
}
