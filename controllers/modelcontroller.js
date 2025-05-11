const StockModel = require('../models/stocks');

async function computeCash(subscription, segments){
  const sumW = segments.reduce((sum,s)=> sum + (s.weightage||0), 0);
  const cashPct = Math.max(0, 100 - sumW);
  const cashAmt = subscription.minInvestment * cashPct / 100;
  return { cashPercent: cashPct, cashAmount: cashAmt };
}

exports.createModel = async (req,res,next) => {
  try {
    const data = req.body;
    const { cashPercent, cashAmount } = await computeCash(data.subscription, data.segments);
    const model = await StockModel.create({
      ...data,
      subscription: { ...data.subscription, cashPercent, cashAmount }
    });
    res.status(201).json(model);
  } catch(err){ next(err); }
};

exports.updateModel = async (req,res,next) => {
  try {
    const data = req.body;
    const { cashPercent, cashAmount } = await computeCash(data.subscription, data.segments);
    const model = await StockModel.findByIdAndUpdate(
      req.params.id,
      { ...data,
        subscription: { ...data.subscription, cashPercent, cashAmount }
      },
      { new:true }
    );
    if(!model) return res.status(404).json({ error:'Not found' });
    res.json(model);
  } catch(err){ next(err); }
};

exports.getAllModels = async (req,res,next) => {
  const all = await StockModel.find();
  res.json(all);
};

exports.getModel = async (req,res,next) => {
  const one = await StockModel.findById(req.params.id);
  if(!one) return res.status(404).json({ error:'Not found' });
  res.json(one);
};
