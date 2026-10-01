import { InfractionsCache } from "@/redis";
import type { DiscordClient } from "@/registry/DiscordClient";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "@/registry/Structure/BaseCommand";
import {
	ActionRowBuilder,
	ApplicationIntegrationType,
	type AutocompleteInteraction,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
    Colors,
	InteractionContextType,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { v4 as uuidv4 } from "uuid";

export default class InfractionControlCommand extends BaseCommand {
	constructor() {
		super(
			// Provides moderator-only subcommands for managing infractions.
			new SlashCommandBuilder()
				.setName("punishment_control")
				.setDescription("Create or delete infraction reasons")
				.addSubcommand((command) =>
					command
                        .setName("add").setDescription("Add an infraction reason")
                        .addStringOption((ruleOption) => 
                            ruleOption
                                .setName("rule")
                                .setDescription("Please only enter the number. The RULE: is already added.")
                                .setRequired(true),
                        )
                        .addStringOption((reasonOption) => 
                            reasonOption
                                .setName("reason")
                                .setDescription("E.g: Discussing Leaks.")
                                .setRequired(true),
                        ),
				)
				.addSubcommand((command) =>
					command
						.setName("remove")
						.setDescription("Remove an infraction reason")
						.addStringOption((option) =>
							option
								.setName("reason")
								.setDescription("Reason to remove")
								.setRequired(true)
								.setAutocomplete(true),
						),
				)
				.setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
		);
	}

	async execute(
		_client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction<"cached">,
	) {
		switch (interaction.options.getSubcommand()) {

			// remove subcommand
			case "remove": {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });

				// remove response from db
				const selectedInfraction = interaction.options.getString("reason", true);
				const separator = selectedInfraction.indexOf(": ");
				const rule =
					separator === -1
						? ""
						: selectedInfraction.slice(0, separator).trim();
				const reason =
					separator === -1
						? selectedInfraction.trim()
						: selectedInfraction.slice(separator + 2).trim();
				const infractions = await InfractionsCache.getAll();

				// reason does not exist
				if (
					!infractions.some(
						(infraction) =>
							infraction.rule === rule && infraction.reason === reason,
					)
				) {
					await interaction.editReply({
						content: "That infraction reason does not exist.",
					});
					return;
				}

				await InfractionsCache.delete({ rule, reason });
				await interaction.editReply({
					content: `## :white_check_mark: Success!\n\(**-**) Removed \`${rule}: ${reason}\` from the infractions list.`,
				});
				return;
			}

			// add subcommand
			case "add": {
				const customId = uuidv4();

				// add it to db in the format:    Rule []: Reason
				const rule = "Rule " + interaction.options.getString("rule", true).trim();
				const reason = interaction.options.getString("reason", true).trim();


				await interaction.deferReply({ flags: MessageFlags.Ephemeral });

				// show preview before adding
				const preview = new EmbedBuilder()
					.setTitle("Preview Infraction Reason")
					.addFields(
						{ name: "Rule", value: rule },
						{ name: "Reason", value: reason}

					)
					.setColor(Colors.Blurple)

				// buttons for adding/cancelling for ease of use
				const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder({
						custom_id: `${customId}_add`,
						label: "Add",
						style: ButtonStyle.Success,
					}),
					new ButtonBuilder({
						custom_id: `${customId}_cancel`,
						label: "Cancel",
						style: ButtonStyle.Danger,
					}),
				);

				const response = await interaction.editReply({
					embeds: [preview],
					components: [buttons],
				});

				let buttonInteraction;

				try {
					buttonInteraction = await response.awaitMessageComponent({
						time: 1_800_000,
						filter: (button) => button.user.id === interaction.user.id,
					});
				} catch (error) {
					await interaction.editReply({
						content: "Infraction creation timed out. Please try again.",
						embeds: [],
						components: [],
					});
					return;
				}

				if (buttonInteraction.customId.endsWith("_cancel")) {
					await buttonInteraction.editReply({
						content: "Infraction creation cancelled.",
						embeds: [],
						components: [],
					});
					return;
				}

				// save the confirmed infraction and clear the preview controls
				await InfractionsCache.set({ rule, reason });
				await buttonInteraction.update({
					content: `## :white_check_mark: Success!\n\n(**+**) Added \`${rule}: ${reason}\` to the infractions list.`,
					embeds: [],
					components: [],
				});
			}
		}
	}

	async autoComplete(interaction: AutocompleteInteraction) {
        // auto complete reason based on search
		const reasons = await InfractionsCache.autoComplete(
			interaction.options.getFocused().toString(),
		);
		await interaction.respond(
			reasons.slice(0, 25).map((reason) => ({
				name: reason,
				value: reason,
			})),
		);
	}
}
