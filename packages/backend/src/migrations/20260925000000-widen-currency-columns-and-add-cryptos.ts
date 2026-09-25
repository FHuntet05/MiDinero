import { QueryInterface, QueryTypes, Transaction } from 'sequelize';
import { createRealTransactionsViewSql, dropRealTransactionsViewSql } from './utils/real-transactions-view';

/**
 * Widens currency code columns across all tables from VARCHAR(3) to VARCHAR(16)
 * to support crypto tokens (e.g. USDT_BEP20, USDT_TRC20, USDT) and regional currencies (MLC).
 * Also seeds these currencies into the Currencies table so they are recognized globally.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      // 0. Drop dependent views (real_transactions) before altering column types,
      // as PostgreSQL refuses to alter columns used by a view.
      await queryInterface.sequelize.query(dropRealTransactionsViewSql, { transaction: t });

      // 1. Find and drop all foreign key constraints referencing Currencies(code)
      // so that Currencies.code and child columns can be altered without constraint violations.
      const foreignKeys = (await queryInterface.sequelize.query(
        `SELECT
          tc.table_name,
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.update_rule,
          rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'Currencies'
          AND ccu.column_name = 'code';`,
        { type: QueryTypes.SELECT, transaction: t },
      )) as Array<{
        table_name: string;
        constraint_name: string;
        column_name: string;
        foreign_table_name: string;
        foreign_column_name: string;
        update_rule: string;
        delete_rule: string;
      }>;

      for (const fk of foreignKeys) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "${fk.table_name}" DROP CONSTRAINT "${fk.constraint_name}";`,
          { transaction: t },
        );
      }

      // 2. Safely widen columns to VARCHAR(16) across all tables
      const columnsToWiden: [string, string][] = [
        ['Currencies', 'code'],
        ['UsersCurrencies', 'currencyCode'],
        ['Accounts', 'currencyCode'],
        ['Transactions', 'currencyCode'],
        ['Transactions', 'refCurrencyCode'],
        ['Transactions', 'originalCurrencyCode'],
        ['ExchangeRates', 'baseCode'],
        ['ExchangeRates', 'quoteCode'],
        ['UserExchangeRates', 'baseCode'],
        ['UserExchangeRates', 'quoteCode'],
        ['Portfolios', 'currencyCode'],
        ['Portfolios', 'displayCurrency'],
        ['PortfolioBalances', 'currencyCode'],
        ['PortfolioTransfers', 'currencyCode'],
        ['PortfolioTransfers', 'refCurrencyCode'],
        ['Subscriptions', 'currencyCode'],
        ['Subscriptions', 'expectedCurrencyCode'],
        ['SubscriptionCandidates', 'currencyCode'],
        ['TransactionTemplates', 'originalCurrencyCode'],
        ['PaymentReminders', 'currencyCode'],
        ['VentureDeals', 'currencyCode'],
        ['VentureEvents', 'currencyCode'],
        ['VentureEventLinks', 'currencyCode'],
        ['InvestmentTransactions', 'currencyCode'],
        ['InvestmentTransactions', 'settlementCurrencyCode'],
        ['Securities', 'currencyCode'],
        ['Holdings', 'currencyCode'],
      ];

      for (const [table, column] of columnsToWiden) {
        await queryInterface.sequelize.query(
          `DO $$
          BEGIN
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = '${table}' AND column_name = '${column}'
            ) THEN
              EXECUTE 'ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE VARCHAR(16);';
            END IF;
          END $$;`,
          { transaction: t },
        );
      }

      // 3. Re-create foreign key constraints
      for (const fk of foreignKeys) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_name}"("${fk.foreign_column_name}") ON UPDATE ${fk.update_rule} ON DELETE ${fk.delete_rule};`,
          { transaction: t },
        );
      }

      // 4. Re-create the real_transactions view with the new column definitions
      await queryInterface.sequelize.query(createRealTransactionsViewSql, { transaction: t });

      // 5. Seed crypto and custom currencies into Currencies table
      const currenciesToSeed = [
        { code: 'USDT_BEP20', currency: 'Tether USD (BEP-20)', digits: 2, number: 9901 },
        { code: 'USDT_TRC20', currency: 'Tether USD (TRC-20)', digits: 2, number: 9902 },
        { code: 'USDT', currency: 'Tether USD', digits: 2, number: 9900 },
        { code: 'MLC', currency: 'Moneda Libremente Convertible', digits: 2, number: 9903 },
      ];

      for (const curr of currenciesToSeed) {
        await queryInterface.sequelize.query(
          `INSERT INTO "Currencies" ("code", "currency", "digits", "number", "isDisabled")
           VALUES ('${curr.code}', '${curr.currency}', ${curr.digits}, ${curr.number}, false)
           ON CONFLICT ("code") DO UPDATE SET "currency" = EXCLUDED."currency", "digits" = EXCLUDED."digits";`,
          { transaction: t },
        );
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    // Cannot cleanly revert column lengths if values > 3 chars exist; ensure view remains valid.
    await queryInterface.sequelize.query(createRealTransactionsViewSql);
  },
};
