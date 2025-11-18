'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('room_settings', 'room_title', {
      type: Sequelize.STRING,
      allowNull: true,
      after: 'room_id'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('room_settings', 'room_title');
  }
};
