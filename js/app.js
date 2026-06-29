// js/app.js
(async () => {
  const container = document.getElementById('products-container');
  if (!container) return;

  console.log('[app] Carregando produtos...');
  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[app] Erro ao carregar produtos:', error);
    container.innerHTML = '<p class="text-danger">Erro ao carregar produtos.</p>';
    return;
  }

  console.log('[app] Produtos carregados:', products.length);

  if (!products.length) {
    container.innerHTML = '<p>Nenhum produto cadastrado.</p>';
    return;
  }

  products.forEach(product => {
    const card = document.createElement('div');
    card.className = 'col-md-4 col-sm-6';
    card.innerHTML = `
      <div class="card product-card h-100">
        <img src="${product.image_url || 'https://via.placeholder.com/300'}" class="card-img-top" alt="${product.name}">
        <div class="card-body d-flex flex-column">
          <h5 class="card-title">${escapeHtml(product.name)}</h5>
          <p class="card-text flex-grow-1">${escapeHtml(product.description)}</p>
          <p class="fw-bold">R$ ${parseFloat(product.price).toFixed(2)}</p>
          <span class="badge bg-${statusBadgeClass(product.status)} mb-2">${product.status}</span>
          ${product.status === 'Disponível' ? 
            `<button class="btn btn-primary btn-buy" data-id="${product.id}">Comprar</button>` : ''}
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  document.querySelectorAll('.btn-buy').forEach(btn => {
    btn.addEventListener('click', handleBuy);
  });
})();

function statusBadgeClass(status) {
  switch(status) {
    case 'Disponível': return 'success';
    case 'Reservado': return 'warning';
    case 'Indisponível Temporariamente': return 'secondary';
    case 'Vendido': return 'dark';
    default: return 'light';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function handleBuy(e) {
  const productId = e.target.dataset.id;
  console.log('[app] Tentando reservar produto:', productId);

  e.target.disabled = true;
  e.target.textContent = 'Reservando...';

  try {
    const { data: token, error } = await supabase.rpc('reserve_product', {
      p_product_id: productId
    });

    if (error) {
      console.error('[app] Erro na RPC reserve_product:', error);
      alert('Não foi possível reservar. Talvez o produto já tenha sido reservado por outra pessoa.');
      e.target.disabled = false;
      e.target.textContent = 'Comprar';
      return;
    }

    console.log('[app] Reserva bem-sucedida. Token:', token);

    // Redireciona para página de pagamento
    const redirectUrl = `pagamento.html?id=${productId}&token=${token}`;
    console.log('[app] Redirecionando para:', redirectUrl);
    window.location.href = redirectUrl;

  } catch (err) {
    console.error('[app] Exceção ao reservar:', err);
    alert('Ocorreu um erro inesperado. Tente novamente.');
    e.target.disabled = false;
    e.target.textContent = 'Comprar';
  }
}
