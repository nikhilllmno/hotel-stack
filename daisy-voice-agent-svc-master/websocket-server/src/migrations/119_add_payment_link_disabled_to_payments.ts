import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'payments',
    'payment_link_disabled',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('payments', (table) => {
      table.boolean('payment_link_disabled');
    });

    // Set to true for all non-PENDING payments that have a payment_link
    await knex('payments')
      .whereNot('payment_status', 'PENDING')
      .whereNotNull('payment_link')
      .update({ payment_link_disabled: true });

    // Set to false for PENDING payments that have a payment_link
    await knex('payments')
      .where('payment_status', 'PENDING')
      .whereNotNull('payment_link')
      .update({ payment_link_disabled: false });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn(
    'payments',
    'payment_link_disabled',
  );
  if (hasColumn) {
    await knex.schema.alterTable('payments', (table) => {
      table.dropColumn('payment_link_disabled');
    });
  }
}
