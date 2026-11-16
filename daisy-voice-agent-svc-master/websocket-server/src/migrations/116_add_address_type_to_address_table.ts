import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('address', 'address_type');
  if (!hasColumn) {
    await knex.schema.alterTable('address', (table) => {
      table.enu('address_type', ['billing', 'contact']).nullable();
    });

    await knex('address').update({ address_type: 'contact' });

    await knex.raw(
      'ALTER TABLE address ALTER COLUMN address_type SET NOT NULL',
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('address', 'address_type');
  if (hasColumn) {
    await knex.schema.alterTable('address', (table) => {
      table.dropColumn('address_type');
    });
  }
}
