// js/pagamento.js
(async () => {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id');
  const token = params.get('token');

  const container = document.getElementById('payment-content');
  if (!productId || !token) {
    container.innerHTML = '<div class="alert alert-danger">Parâmetros inválidos.</div>';
    return;
  }

  // Busca produto e configuração
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();

  if (productError || !product) {
    container.innerHTML = '<div class="alert alert-danger">Produto não encontrado.</div>';
    return;
  }

  // Valida token e estado da reserva
  if (product.reservation_token !== token || product.status !== 'Reservado') {
    container.innerHTML = '<div class="alert alert-warning">Reserva inválida ou expirada. <a href="/">Voltar</a></div>';
    return;
  }

  const { data: config, error: configError } = await supabase
    .from('config')
    .select('*')
    .eq('id', 1)
    .single();

  if (configError) {
    container.innerHTML = '<div class="alert alert-danger">Erro ao carregar configurações de pagamento.</div>';
    return;
  }

  // Renderiza a página de pagamento
  const reservedAt = new Date(product.reserved_at);
  const expiresAt = new Date(reservedAt.getTime() + 10 * 60 * 1000);
  renderPaymentPage(product, config, expiresAt);
})();

function renderPaymentPage(product, config, expiresAt) {
  const container = document.getElementById('payment-content');
  container.innerHTML = `
    <div class="row">
      <div class="col-md-6">
        <img src="${product.image_url || 'https://via.placeholder.com/400'}" class="img-fluid rounded" alt="${product.name}">
      </div>
      <div class="col-md-6">
        <h2>${escapeHtml(product.name)}</h2>
        <p>${escapeHtml(product.description)}</p>
        <h3 class="text-success">R$ ${parseFloat(product.price).toFixed(2)}</h3>
        <div class="payment-box p-4 my-3">
          <p class="fw-bold">Pague via Pix:</p>
          ${config.pix_qr_code_url ? `<img src="${config.pix_qr_code_url}" class="img-fluid mb-2" alt="QR Code Pix">` : ''}
          <div class="input-group mb-3">
            <input type="text" id="pix-copy" class="form-control" value="${config.pix_copy_paste || ''}" readonly>
            <button class="btn btn-outline-secondary" onclick="copyPix()">Copiar</button>
          </div>
          <div class="text-center mb-3">
            <strong>Tempo restante: <span id="timer" class="timer text-danger"></span></strong>
          </div>
          <a id="whatsapp-link" href="${buildWhatsAppLink(product, config)}" target="_blank" class="btn whatsapp-btn text-white w-100">
            Confirmar pagamento via WhatsApp
          </a>
        </div>
        <p class="small">Após o pagamento, clique no botão acima para avisar o vendedor.</p>
      </div>
    </div>
  `;

  // Inicia o cronômetro
  startTimer(expiresAt, product.id);
}

function buildWhatsAppLink(product, config) {
  const message = `Olá! Gostaria de confirmar o pagamento do produto "${product.name}" no valor de R$ ${parseFloat(product.price).toFixed(2)}.`;
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${config.whatsapp_number}?text=${encoded}`;
}

function startTimer(expiresAt, productId) {
  const timerEl = document.getElementById('timer');
  if (!timerEl) return;

  const tick = async () => {
    const now = new Date();
    const diff = expiresAt - now;
    if (diff <= 0) {
      timerEl.textContent = '00:00';
      clearInterval(interval);
      // Tenta expirar a reserva no backend
      await supabase.rpc('expire_reservation', { p_product_id: productId });
      document.querySelector('.payment-box').innerHTML = '<div class="alert alert-warning">Reserva expirada. Este produto não está mais disponível.</div>';
      return;
    }
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  tick();
  const interval = setInterval(tick, 1000);
}

function copyPix() {
  const input = document.getElementById('pix-copy');
  input.select();
  document.execCommand('copy');
  alert('Código Pix copiado!');
}
