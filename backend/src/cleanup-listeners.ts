// Cleanup script for orphaned listeners
import 'reflect-metadata';
import { Op } from 'sequelize';
import { connectDatabase, closeDatabase } from './infrastructure/database/sequelize';
import { Listener } from './models/Listener';

async function cleanupOrphanedListeners() {
  console.log('Starting cleanup of orphaned listeners...');

  await connectDatabase();

  // Get all listeners that have been connected for more than 1 hour without leftAt set
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [affectedCount] = await Listener.update(
    { leftAt: new Date() },
    {
      where: {
        leftAt: null,
        joinedAt: {
          [Op.lt]: oneHourAgo
        }
      }
    }
  );

  console.log(`Cleaned up ${affectedCount} orphaned listeners`);

  // Also delete very old listeners (more than 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const deleted = await Listener.destroy({
    where: {
      leftAt: {
        [Op.lt]: sevenDaysAgo
      }
    }
  });

  console.log(`Deleted ${deleted} old listener records`);

  await closeDatabase();
}

cleanupOrphanedListeners().catch(console.error);
