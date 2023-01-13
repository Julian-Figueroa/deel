const express = require('express');
const bodyParser = require('body-parser');
const { sequelize } = require('./model');
const { getProfile } = require('./middleware/getProfile');
const { Op, QueryTypes } = require('sequelize');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

/**
 * GET /contracts/:id
 * @returns the contract only if it belongs to the profile calling
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
  const profileId = req?.profile?.dataValues?.id;
  const { Contract } = req.app.get('models');
  const { id } = req.params;
  const contract = await Contract.findOne({
    where: {
      [Op.and]: [{ id }, { ContractorId: profileId }],
    },
  });
  if (!contract) return res.status(404).end();
  res.json(contract);
});

/**
 * GET /contracts
 * @returns a list of contracts belonging to a user (client or contractor), the list should only contain non terminated contracts.
 */
app.get('/contracts', getProfile, async (req, res) => {
  const profileId = req?.profile?.dataValues?.id;
  const query = `SELECT * FROM Contracts AS Contract WHERE (Contract.ClientId = ${profileId} OR Contract.ContractorId = ${profileId}) AND (Contract.status NOT IN ('terminated'))`;
  const contracts = await sequelize.query(query, { type: QueryTypes.SELECT });
  if (!contracts?.length) return res.status(404).end();
  res.json(contracts);
});

/**
 * GET /jobs/unpaid
 * @returns a list of contracts belonging to a user (client or contractor), the list should only contain non terminated contracts.
 */
app.get('/jobs/unpaid', getProfile, async (_, res) => {
  const query = `SELECT Job.* from Jobs as Job, Contracts AS Contract where Job.ContractId = Contract.id AND (Contract.status NOT IN ('terminated')) AND (Job.paid IS NULL)`;
  const unpaidJobs = await sequelize.query(query, { type: QueryTypes.SELECT });
  if (!unpaidJobs?.length) return res.status(404).end();
  res.json(unpaidJobs);
});

/**
 * POST /jobs/:job_id/pay
 * Pay for a job, a client can only pay if his balance >= the amount to pay. The amount should be moved from the client's balance to the contractor balance
 * @returns the report of the payment, including the paid amount
 */
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
  const { job_id: jobId } = req?.params;
  const jobQuery = `SELECT Job.price, Contract.ClientId, Contract.ContractorId from Jobs as Job, Contracts AS Contract where Job.ContractId = Contract.id AND Job.ContractId = ${jobId} AND (Contract.status NOT IN ('terminated')) AND (Job.paid IS NULL)`;
  const jobsToPay = await sequelize.query(jobQuery, { type: QueryTypes.SELECT });
  const { price, ClientId, ContractorId } = jobsToPay?.[0];
  const clientQuery = `SELECT Profile.balance FROM Profiles AS Profile WHERE Profile.id = ${ClientId} AND type = 'client'`;
  const clientsBalance = await sequelize.query(clientQuery, { type: QueryTypes.SELECT });
  const { balance } = clientsBalance?.[0];
  if (balance >= price) {
    // Payment to contractor
    const [resultsPayment, _] = await sequelize.query(
      `UPDATE Profiles SET balance = (balance + ${price}) WHERE id = ${ContractorId} AND type = 'contractor'`
    );
    // Debit to Client
    const [resultsDebit, __] = await sequelize.query(
      `UPDATE Profiles SET balance = (balance - ${price}) WHERE id = ${ClientId} AND type = 'client'`
    );
    res.json({
      status: 200,
      message: 'Successful payment',
      resultsPayment,
      resultsDebit,
    });
  }
  return res.status(500).end();
});

/**
 * GET /admin/best-clients?start=<date>&end=<date>&limit=<integer>
 * @returns the clients the paid the most for jobs in the query time period. limit query parameter should be applied, default limit is 2.
 */
app.get('/admin/best-clients', getProfile, async (req, res) => {
  let limit = 2;
  const { start, end } = req?.query;
  limit = req?.params?.limit ? req?.params?.limit : limit;
  const sumQuery = `SELECT ContractId, SUM(price) as paid FROM Jobs GROUP BY ContractId ORDER BY SUM(price) DESC LIMIT ${limit}`;
  const sum = await sequelize.query(sumQuery, { type: QueryTypes.SELECT });
  res.json(sum);
});
module.exports = app;
