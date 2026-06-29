// components/PredictorDashboard.jsx
import React, { useState } from 'react';
import axios from 'axios';
// import { API_BASE } from '../config'; 

const PredictorDashboard = ({ user }) => { 
  const [inputs, setInputs] = useState({
    mainsRank: '',
    advRank: '',
    category: 'OPEN',
    gender: 'Gender-Neutral',
    domicileState: 'Haryana',
    types: ['IIT', 'NIT', 'IIIT', 'GFTI']
  });

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // State to control if the mobile filter menu is open or closed
  const [isFiltersOpen, setIsFiltersOpen] = useState(true);

  const handleFilterToggle = (type) => {
    setInputs(prev => ({
      ...prev,
      types: prev.types.includes(type) 
        ? prev.types.filter(t => t !== type)
        : [...prev.types, type]
    }));
  };

  const fetchPredictions = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...inputs,
        mainsRank: Number(inputs.mainsRank),
        advRank: inputs.advRank ? Number(inputs.advRank) : null
      };
      
      const res = await axios.post('/api/predict', payload);
      setResults(res.data.data);
      
      // Auto-collapse the filters ONLY on mobile devices (width < 1024px)
      if (window.innerWidth < 1024) {
        setIsFiltersOpen(false);
      }
      
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-[1600px] mx-auto p-4 sm:p-6 min-h-screen flex flex-col bg-[#0B0F19] text-white">
      
      <div className="flex-grow">
        
        {/* Responsive Header Row */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 sm:mb-8 pb-4 border-b border-gray-800">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-100">Predictor Engine</h1>
          
          <div className="md:hidden mt-3 text-xs tracking-widest text-gray-400 bg-[#111827] px-4 py-1.5 rounded-full border border-gray-800 shadow-sm">
            Made with 💛 by <span className="font-bold text-gray-200">π</span>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          
          {/* LEFT SIDEBAR: Form Panel */}
          <div className="relative z-20 lg:col-span-4 bg-[#111827] p-5 sm:p-6 rounded-xl shadow-lg border border-gray-800 h-fit">
            
            {/* Clickable Header to toggle form on mobile */}
            <div 
              className="flex justify-between items-center cursor-pointer lg:cursor-default"
              onClick={() => {
                if (window.innerWidth < 1024) setIsFiltersOpen(!isFiltersOpen);
              }}
            >
              <h2 className="text-xl font-bold border-l-4 border-cyan-400 pl-3">Input Matrix</h2>
              <button type="button" className="lg:hidden text-gray-400 p-2">
                {isFiltersOpen ? '▲' : '▼'}
              </button>
            </div>

            {/* Flawless Accordion Wrapper using max-height */}
            <div 
              className={`overflow-hidden transition-all duration-500 ease-in-out lg:max-h-[2000px] lg:opacity-100 ${
                isFiltersOpen ? 'max-h-[2000px] opacity-100 mt-6' : 'max-h-0 opacity-0 mt-0'
              }`}
            >
              <form onSubmit={fetchPredictions} className="space-y-5">
                
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">JEE Mains Rank *</label>
                  <input type="number" required className="w-full bg-[#0B0F19] border border-gray-700 text-white rounded mt-1.5 p-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" 
                    value={inputs.mainsRank} onChange={e => setInputs({...inputs, mainsRank: e.target.value})} />
                </div>
                
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">JEE Advanced Rank <span className="text-gray-600 lowercase">(opt)</span></label>
                  <input type="number" className="w-full bg-[#0B0F19] border border-gray-700 text-white rounded mt-1.5 p-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" 
                    value={inputs.advRank} onChange={e => setInputs({...inputs, advRank: e.target.value})} />
                </div>

                <div className="pt-2">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Institute Types</label>
                  <div className="flex flex-wrap gap-2 sm:gap-3">
                    {['IIT', 'NIT', 'IIIT', 'GFTI'].map(type => (
                      <button 
                        key={type} type="button"
                        onClick={() => handleFilterToggle(type)}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${inputs.types.includes(type) ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-[#1F2937] text-gray-400 hover:bg-[#374151]'}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <button type="submit" className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 transition-all text-white font-bold py-3.5 rounded-lg shadow-lg mt-4">
                  {loading ? 'Crunching Data...' : 'Execute Analysis'}
                </button>
              </form>
            </div>
          </div>

          {/* RIGHT SIDE: Results Panel */}
          <div className="lg:col-span-8">
            {results.length > 0 ? (
              <div className="space-y-4">
                {results.map((college, idx) => (
                  <div key={idx} className="bg-[#111827] p-4 sm:p-5 rounded-xl shadow-md flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 border border-gray-800 hover:border-gray-700 transition-colors">
                    
                    <div className="w-full sm:w-auto">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs font-bold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">{college.type}</span>
                        <span className="text-xs font-semibold text-gray-500">{college.quota} QUOTA</span>
                      </div>
                      <h3 className="font-bold text-base sm:text-lg text-gray-100 leading-tight">{college.institute}</h3>
                      <p className="text-sm text-gray-400 mt-1">{college.program}</p>
                      
                      <div className="flex gap-4 mt-3">
                        <div>
                          <p className="text-xs text-gray-500 uppercase">Expected Cutoff</p>
                          <p className="font-semibold text-gray-200">{college.predictedClosingRank}</p>
                        </div>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto flex justify-end">
                      <div className={`px-4 py-1.5 rounded-full text-sm font-bold shadow-sm border
                        ${college.chanceScore === 'High' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                        : college.chanceScore === 'Medium' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' 
                        : 'bg-red-500/10 text-red-400 border-red-500/20'}`}
                      >
                        {college.chanceScore} Chance
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            ) : (
              <div className="h-64 sm:h-full flex flex-col items-center justify-center text-gray-500 bg-[#111827] rounded-xl border border-dashed border-gray-800 p-6 sm:p-10 text-center">
                <span className="text-4xl mb-3 opacity-50">🔍</span>
                <p className="font-semibold text-lg text-gray-300">No Vectors Found</p>
                <p className="text-sm mt-1 max-w-sm">Initialize parameters inside the input matrix to compute admission bounds.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PredictorDashboard;
