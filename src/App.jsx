import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from "firebase/firestore";

// Configuração do Firebase do seu projeto "doces-nuvem"
const firebaseConfig = {
  apiKey: "AIzaSyAjlbfmO_RH-1mcw-LqfNGVFVd_C_vWQAc",
  authDomain: "doces-nuvem.firebaseapp.com",
  projectId: "doces-nuvem",
  storageBucket: "doces-nuvem.firebasestorage.app",
  messagingSenderId: "146544791538",
  appId: "1:146544791538:web:90603156c225fc0bc3e56b",
  measurementId: "G-1KSKRKP077"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export default function ConfeitariaApp() {
  const [abaAtiva, setAbaAtiva] = useState('pdv');
  const [produtos, setProdutos] = useState([]);
  const [encomendas, setEncomendas] = useState([]);
  const [transacoes, setTransacoes] = useState([]);
  const [carrinho, setCarrinho] = useState([]);
  const [statusNuvem, setStatusNuvem] = useState('A ligar à nuvem...');
  const [statusCor, setStatusCor] = useState('bg-amber-400 animate-ping');

  // Estados dos formulários
  const [formProd, setFormProd] = useState({ nome: '', categoria: 'Bolos & Fatias', preco: '', estoque: '' });
  const [formEnc, setFormEnc] = useState({ cliente: '', whats: '', descricao: '', data: '', total: '', sinal: 0 });
  const [formCx, setFormCx] = useState({ descricao: '', valor: '', tipo: 'saida' });
  const [metodoPagamento, setMetodoPagamento] = useState('PIX');

  useEffect(() => {
    signInAnonymously(auth).catch((err) => {
      setStatusNuvem("Erro de autenticação anónima no Firebase");
      setStatusCor('bg-red-500');
    });

    onAuthStateChanged(auth, (user) => {
      if (!user) return;
      setStatusNuvem("Nuvem Sincronizada (doces-nuvem)");
      setStatusCor('bg-emerald-500');

      onSnapshot(collection(db, "produtos"), (snap) => {
        setProdutos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      onSnapshot(collection(db, "encomendas"), (snap) => {
        setEncomendas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      onSnapshot(collection(db, "transacoes"), (snap) => {
        setTransacoes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    });
  }, []);

  const formatarMoeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // Cálculos de KPI
  const saldoCaixa = transacoes.reduce((acc, t) => t.tipo === 'entrada' ? acc + Number(t.valor) : acc - Number(t.valor), 0);
  const totalEncomendasPendentes = encomendas.filter(e => e.status !== 'Entregue').length;
  const totalVitrine = produtos.reduce((acc, p) => acc + Number(p.estoque || 0), 0);

  // Ações do PDV
  const adicionarAoCarrinho = (prod) => {
    if (prod.estoque <= 0) return;
    const item = carrinho.find(i => i.id === prod.id);
    if (item) {
      if (item.qtd < prod.estoque) {
        setCarrinho(carrinho.map(i => i.id === prod.id ? { ...i, qtd: i.qtd + 1 } : i));
      }
    } else {
      setCarrinho([...carrinho, { id: prod.id, nome: prod.nome, preco: Number(prod.preco), qtd: 1 }]);
    }
  };

  const removerDoCarrinho = (id) => setCarrinho(carrinho.filter(i => i.id !== id));
  const totalCarrinho = carrinho.reduce((acc, i) => acc + (i.preco * i.qtd), 0);

  const finalizarVenda = async () => {
    if (carrinho.length === 0) return;
    const resumo = carrinho.map(i => `${i.qtd}x ${i.nome}`).join(', ');

    for (const item of carrinho) {
      const p = produtos.find(prod => prod.id === item.id);
      if (p) {
        await updateDoc(doc(db, "produtos", item.id), { estoque: Math.max(0, Number(p.estoque) - item.qtd) });
      }
    }

    await addDoc(collection(db, "transacoes"), {
      descricao: `Venda Balcão (${metodoPagamento}): ${resumo}`,
      valor: totalCarrinho,
      tipo: 'entrada',
      data: new Date().toLocaleString('pt-BR')
    });

    setCarrinho([]);
  };

  // Cadastros e Gestão
  const salvarProduto = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "produtos"), {
      nome: formProd.nome,
      categoria: formProd.categoria,
      preco: Number(formProd.preco),
      estoque: Number(formProd.estoque)
    });
    setFormProd({ nome: '', categoria: 'Bolos & Fatias', preco: '', estoque: '' });
  };

  const abastecerFornada = async (id, atual) => {
    await updateDoc(doc(db, "produtos", id), { estoque: Number(atual) + 6 });
  };

  const salvarEncomenda = async (e) => {
    e.preventDefault();
    const sinalVal = Number(formEnc.sinal || 0);
    await addDoc(collection(db, "encomendas"), {
      cliente: formEnc.cliente,
      whats: formEnc.whats,
      descricao: formEnc.descricao,
      data: formEnc.data,
      total: Number(formEnc.total),
      sinal: sinalVal,
      status: 'Em Produção'
    });

    if (sinalVal > 0) {
      await addDoc(collection(db, "transacoes"), {
        descricao: `Sinal Encomenda - ${formEnc.cliente}`,
        valor: sinalVal,
        tipo: 'entrada',
        data: new Date().toLocaleString('pt-BR')
      });
    }
    setFormEnc({ cliente: '', whats: '', descricao: '', data: '', total: '', sinal: 0 });
  };

  const entregarEncomenda = async (enc) => {
    await updateDoc(doc(db, "encomendas", enc.id), { status: 'Entregue' });
    const falta = Math.max(0, Number(enc.total) - Number(enc.sinal));
    if (falta > 0) {
      await addDoc(collection(db, "transacoes"), {
        descricao: `Restante Encomenda - ${enc.cliente}`,
        valor: falta,
        tipo: 'entrada',
        data: new Date().toLocaleString('pt-BR')
      });
    }
  };

  const salvarTransacao = async (e) => {
    e.preventDefault();
    await addDoc(collection(db, "transacoes"), {
      descricao: formCx.descricao,
      valor: Number(formCx.valor),
      tipo: formCx.tipo,
      data: new Date().toLocaleString('pt-BR')
    });
    setFormCx({ descricao: '', valor: '', tipo: 'saida' });
  };

  const excluirDoc = async (col, id) => {
    await deleteDoc(doc(db, col, id));
  };

  const carregarExemplos = async () => {
    const exemplos = [
      { nome: "Fatia Red Velvet", categoria: "Bolos & Fatias", preco: 16.50, estoque: 8 },
      { nome: "Bolo de Pote Ninho c/ Nutella", categoria: "Bolos & Fatias", preco: 14.00, estoque: 12 },
      { nome: "Coxinha de Morango", categoria: "Doces & Brigadeiros", preco: 8.50, estoque: 15 },
      { nome: "Croissant Recheado", categoria: "Salgados", preco: 12.00, estoque: 6 },
      { nome: "Café Expresso Duplo", categoria: "Bebidas & Cafés", preco: 7.00, estoque: 30 }
    ];
    for (const item of exemplos) {
      await addDoc(collection(db, "produtos"), item);
    }
  };

  const exportarCSV = () => {
    const linhas = [["Descricao", "Tipo", "Valor", "Data"]];
    transacoes.forEach(t => linhas.push([`"${t.descricao}"`, t.tipo, t.valor, `"${t.data || ''}"`]));
    const blob = new Blob([linhas.map(l => l.join(",")).join("\n")], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "caixa-doce-nuvem.csv";
    a.click();
  };

  return (
    <div className="bg-rose-50/40 text-slate-800 min-h-screen flex flex-col font-sans">
      <header className="bg-white border-b border-rose-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center text-white font-extrabold text-xl shadow-md">
              🧁
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900 leading-tight">Doce Nuvem</h1>
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <span className={`w-2 h-2 rounded-full ${statusCor}`}></span>
                <span>{statusNuvem}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={carregarExemplos} className="px-3 py-2 text-xs font-bold rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 transition">
              ✨ Carregar Vitrine
            </button>
            <button onClick={exportarCSV} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition">
              📥 Exportar Caixa
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 flex gap-2 overflow-x-auto border-t border-rose-50 pt-2">
          <button onClick={() => setAbaAtiva('pdv')} className={`px-4 py-2 text-sm font-bold border-b-2 whitespace-nowrap ${abaAtiva === 'pdv' ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-500'}`}>🛒 PDV Balcão</button>
          <button onClick={() => setAbaAtiva('encomendas')} className={`px-4 py-2 text-sm font-bold border-b-2 whitespace-nowrap ${abaAtiva === 'encomendas' ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-500'}`}>🎂 Encomendas</button>
          <button onClick={() => setAbaAtiva('vitrine')} className={`px-4 py-2 text-sm font-bold border-b-2 whitespace-nowrap ${abaAtiva === 'vitrine' ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-500'}`}>🥐 Vitrine & Estoque</button>
          <button onClick={() => setAbaAtiva('caixa')} className={`px-4 py-2 text-sm font-bold border-b-2 whitespace-nowrap ${abaAtiva === 'caixa' ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-500'}`}>💰 Fluxo de Caixa</button>
        </div>
      </header>

      {/* KPIs */}
      <section className="max-w-7xl mx-auto w-full px-4 pt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm flex items-center justify-between">
          <div><p className="text-xs font-semibold text-slate-400 uppercase">Saldo em Caixa</p><p className="text-2xl font-extrabold text-emerald-600 mt-0.5">{formatarMoeda(saldoCaixa)}</p></div>
          <div className="text-2xl bg-emerald-50 p-3 rounded-xl">💵</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm flex items-center justify-between">
          <div><p className="text-xs font-semibold text-slate-400 uppercase">Encomendas Pendentes</p><p className="text-2xl font-extrabold text-amber-600 mt-0.5">{totalEncomendasPendentes}</p></div>
          <div className="text-2xl bg-amber-50 p-3 rounded-xl">🎂</div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-rose-100 shadow-sm flex items-center justify-between">
          <div><p className="text-xs font-semibold text-slate-400 uppercase">Itens na Vitrine</p><p className="text-2xl font-extrabold text-rose-600 mt-0.5">{totalVitrine} un.</p></div>
          <div className="text-2xl bg-rose-50 p-3 rounded-xl">🧁</div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1">
        {/* ABA 1: PDV */}
        {abaAtiva === 'pdv' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-rose-100 shadow-sm">
              <h2 className="text-base font-bold text-slate-800 mb-4">Toque nos produtos para registrar a venda</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {produtos.length === 0 ? <p className="col-span-full text-sm text-slate-400 py-6 text-center">Nenhum produto cadastrado. Clique em "Carregar Vitrine" no topo!</p> :
                  produtos.map(p => (
                    <button key={p.id} onClick={() => adicionarAoCarrinho(p)} disabled={p.estoque <= 0}
                      className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${p.estoque > 0 ? 'border-rose-100 hover:border-rose-400 hover:bg-rose-50/40 bg-white' : 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'}`}>
                      <div>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">{p.categoria}</span>
                        <p className="font-bold text-slate-800 text-sm mt-1.5">{p.nome}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="font-extrabold text-rose-600 text-sm">{formatarMoeda(p.preco)}</span>
                        <span className="text-xs font-semibold text-slate-400">{p.estoque} un.</span>
                      </div>
                    </button>
                  ))
                }
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-3">Comanda do Balcão</h2>
                <div className="space-y-2 max-h-64 overflow-y-auto mb-4 text-sm">
                  {carrinho.length === 0 ? <p className="text-slate-400">Nenhum item selecionado.</p> :
                    carrinho.map(i => (
                      <div key={i.id} className="flex justify-between items-center bg-rose-50/60 p-2 rounded-lg">
                        <div><p className="font-bold text-slate-800 text-xs">{i.qtd}x {i.nome}</p><p className="text-xs text-rose-600 font-semibold">{formatarMoeda(i.preco * i.qtd)}</p></div>
                        <button onClick={() => removerDoCarrinho(i.id)} className="text-xs text-red-500 font-bold px-2">✕</button>
                      </div>
                    ))
                  }
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-semibold text-slate-500">Total:</span>
                  <span className="text-2xl font-extrabold text-rose-600">{formatarMoeda(totalCarrinho)}</span>
                </div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Pagamento</label>
                <select value={metodoPagamento} onChange={e => setMetodoPagamento(e.target.value)} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm font-semibold mb-3">
                  <option value="PIX">⚡ PIX</option>
                  <option value="Cartão">💳 Cartão</option>
                  <option value="Dinheiro">💵 Dinheiro</option>
                </select>
                <button onClick={finalizarVenda} className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-md transition">
                  ✅ Finalizar Venda
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ABA 2: ENCOMENDAS */}
        {abaAtiva === 'encomendas' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <form onSubmit={salvarEncomenda} className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm space-y-3 h-fit">
              <h2 className="text-base font-bold text-slate-800">Nova Encomenda</h2>
              <input required placeholder="Cliente" value={formEnc.cliente} onChange={e => setFormEnc({...formEnc, cliente: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              <input placeholder="WhatsApp" value={formEnc.whats} onChange={e => setFormEnc({...formEnc, whats: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              <input required placeholder="Descrição do Bolo / Doces" value={formEnc.descricao} onChange={e => setFormEnc({...formEnc, descricao: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" required value={formEnc.data} onChange={e => setFormEnc({...formEnc, data: e.target.value})} className="w-full p-2 rounded-xl border border-slate-200 text-sm" />
                <input type="number" step="0.01" required placeholder="Total R$" value={formEnc.total} onChange={e => setFormEnc({...formEnc, total: e.target.value})} className="w-full p-2 rounded-xl border border-slate-200 text-sm" />
              </div>
              <input type="number" step="0.01" placeholder="Sinal pago R$" value={formEnc.sinal} onChange={e => setFormEnc({...formEnc, sinal: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              <button type="submit" className="w-full py-2.5 rounded-xl bg-rose-600 text-white font-bold text-sm">Agendar Encomenda</button>
            </form>

            <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-rose-100 shadow-sm">
              <h2 className="text-base font-bold text-slate-800 mb-4">Lista de Encomendas</h2>
              <div className="space-y-3">
                {encomendas.map(e => {
                  const falta = Math.max(0, Number(e.total) - Number(e.sinal));
                  return (
                    <div key={e.id} className="p-3.5 rounded-xl border border-slate-100 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-800">{e.cliente}</span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${e.status === 'Entregue' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{e.status}</span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">{e.descricao} • Entrega: {e.data}</p>
                        <p className="text-xs text-slate-400 mt-0.5">Total: {formatarMoeda(e.total)} | Sinal: {formatarMoeda(e.sinal)} | <b>Falta: {formatarMoeda(falta)}</b></p>
                      </div>
                      <div className="flex items-center gap-2">
                        {e.status !== 'Entregue' && <button onClick={() => entregarEncomenda(e)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white">✅ Entregar</button>}
                        <button onClick={() => excluirDoc('encomendas', e.id)} className="text-slate-400 hover:text-red-600">🗑️</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ABA 3: VITRINE */}
        {abaAtiva === 'vitrine' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <form onSubmit={salvarProduto} className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm space-y-3 h-fit">
              <h2 className="text-base font-bold text-slate-800">Novo Produto</h2>
              <input required placeholder="Nome do Doce" value={formProd.nome} onChange={e => setFormProd({...formProd, nome: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              <select value={formProd.categoria} onChange={e => setFormProd({...formProd, categoria: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm">
                <option value="Bolos & Fatias">🍰 Bolos & Fatias</option>
                <option value="Doces & Brigadeiros">🍫 Doces & Brigadeiros</option>
                <option value="Salgados">🥐 Salgados</option>
                <option value="Bebidas & Cafés">☕ Bebidas & Cafés</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.01" required placeholder="Preço R$" value={formProd.preco} onChange={e => setFormProd({...formProd, preco: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
                <input type="number" required placeholder="Qtd Vitrine" value={formProd.estoque} onChange={e => setFormProd({...formProd, estoque: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-rose-600 text-white font-bold text-sm">Adicionar à Vitrine</button>
            </form>

            <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-rose-100 shadow-sm">
              <h2 className="text-base font-bold text-slate-800 mb-4">Controle de Estoque</h2>
              <div className="space-y-2.5">
                {produtos.map(p => (
                  <div key={p.id} className="p-3 rounded-xl border border-slate-100 flex items-center justify-between gap-2">
                    <div><p className="font-bold text-sm text-slate-800">{p.nome}</p><p className="text-xs text-slate-400">{p.categoria} • {formatarMoeda(p.preco)}</p></div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-100">{p.estoque} un.</span>
                      <button onClick={() => abastecerFornada(p.id, p.estoque)} className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-100 text-emerald-700">+6 Fornada</button>
                      <button onClick={() => excluirDoc('produtos', p.id)} className="text-slate-400 hover:text-red-600">🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ABA 4: CAIXA */}
        {abaAtiva === 'caixa' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <form onSubmit={salvarTransacao} className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm space-y-3 h-fit">
              <h2 className="text-base font-bold text-slate-800">Lançar Caixa</h2>
              <input required placeholder="Descrição (Ex: Compra de embalagens)" value={formCx.descricao} onChange={e => setFormCx({...formCx, descricao: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              <input type="number" step="0.01" required placeholder="Valor R$" value={formCx.valor} onChange={e => setFormCx({...formCx, valor: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm" />
              <select value={formCx.tipo} onChange={e => setFormCx({...formCx, tipo: e.target.value})} className="w-full p-2.5 rounded-xl border border-slate-200 text-sm font-semibold">
                <option value="saida">🔴 Saída (Despesa)</option>
                <option value="entrada">🟢 Entrada Avulsa</option>
              </select>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-slate-800 text-white font-bold text-sm">Registrar</button>
            </form>

            <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-rose-100 shadow-sm">
              <h2 className="text-base font-bold text-slate-800 mb-4">Histórico Financeiro</h2>
              <div className="space-y-2">
                {transacoes.map(t => (
                  <div key={t.id} className="p-3 rounded-xl border border-slate-100 flex items-center justify-between">
                    <div><p className="font-semibold text-sm text-slate-800">{t.descricao}</p><p className="text-xs text-slate-400">{t.data}</p></div>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold text-sm ${t.tipo === 'entrada' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {t.tipo === 'entrada' ? '+' : '-'} {formatarMoeda(t.valor)}
                      </span>
                      <button onClick={() => excluirDoc('transacoes', t.id)} className="text-slate-400 hover:text-red-600">🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
