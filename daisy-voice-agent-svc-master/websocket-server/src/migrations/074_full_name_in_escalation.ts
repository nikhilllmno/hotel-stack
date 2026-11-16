import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('escalations', (table) => {
    table.string('full_name').nullable();
  });

  // Populate full_name from first_name and last_name
  await knex.raw(`
    UPDATE escalations
    SET full_name = CASE
      WHEN first_name IS NOT NULL AND first_name != '' AND last_name IS NOT NULL AND last_name != '' 
        THEN CONCAT(first_name, ' ', last_name)
      WHEN first_name IS NOT NULL AND first_name != '' 
        THEN first_name
      ELSE 'Guest'
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('escalations', (table) => {
    table.dropColumn('full_name');
  });
}
