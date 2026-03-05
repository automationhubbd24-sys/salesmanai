const express = require('express');
const router = express.Router();
const dbAdminController = require('../controllers/dbAdminController');

router.get('/tables', dbAdminController.listTables);
router.get('/table/:table', dbAdminController.getTableData);
router.post('/table', dbAdminController.createTable);
router.post('/table/:table/insert', dbAdminController.insertRow);
router.post('/table/:table/update', dbAdminController.updateRow);
router.post('/table/:table/delete', dbAdminController.deleteRow);
router.post('/table/:table/column', dbAdminController.addColumn);
router.post('/sql', dbAdminController.runSql);

module.exports = router;
