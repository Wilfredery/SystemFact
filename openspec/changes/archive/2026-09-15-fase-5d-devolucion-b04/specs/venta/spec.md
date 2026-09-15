# Delta for venta

## ADDED Requirements

### Requirement: Return-related error codes in VentaResult catalog (R-V13-add)

The domain MUST add four stable error codes to the `VentaResult<T>` catalog for return operations: `DEVOLUCION_FUERA_DE_PLAZO`, `CANTIDAD_EXCEDE_ORIGINAL`, `FACTURA_NO_VIGENTE`, `VENTA_NO_CONFIRMADA`. Each MUST carry a stable code + user message + minimal context. Stack traces/internal Prisma errors MUST NOT surface.

#### Scenario: Return outside window surfaces stable code

- GIVEN a sale dated 20 days ago with `PLAZO_DEVOLUCION` = 15
- WHEN `crearDevolucion` runs
- THEN `DEVOLUCION_FUERA_DE_PLAZO` returns as a typed business error with user message
- TEST: unit

#### Scenario: Cumulative quantity exceeded surfaces stable code

- GIVEN all units of a line already returned across prior NCs
- WHEN a return requesting more is attempted
- THEN `CANTIDAD_EXCEDE_ORIGINAL` returns as a typed business error
- TEST: unit

#### Scenario: ANULADA source FACTURA surfaces stable code

- GIVEN a sale whose FACTURA is `ANULADA`
- WHEN return is attempted
- THEN `FACTURA_NO_VIGENTE` returns as a typed business error
- TEST: unit

#### Scenario: BORRADOR source sale surfaces stable code

- GIVEN a `BORRADOR` sale
- WHEN return is attempted
- THEN `VENTA_NO_CONFIRMADA` returns as a typed business error
- TEST: unit

## MODIFIED Requirements

### Requirement: Pinned venta error catalog (R-V13)

The domain MUST expose `VentaResult<T>` over one versioned stable-code catalog — **23 codes** — base: `VENTA_NO_ENCONTRADO`, `VENTA_INMUTABLE`, `CONCURRENCIA_CONFLICTO`, `LINEAS_VACIAS`, `LINEA_INVALIDA`, `PRODUCTO_NO_ENCONTRADO`, `PRODUCTO_INACTIVO`, `TASA_ITBIS_VIGENCIA_FALTA`, `DESCUENTO_EXCEDE_MAXIMO`, `DESCUENTO_EXCEDE_BASE`, `DESCUENTO_INVALIDO`, `DESCUENTO_NO_AUTORIZADO`, `CLIENTE_NO_ENCONTRADO`, `CLIENTE_INACTIVO`; 5c confirm (R-V15): `NCF_AGOTADA`, `NCF_VENCIDA`, `NCF_SEC_INEXISTENTE`, `FACTURA_AUTOMATICA_FALTA`, `STOCK_INSUFICIENTE_BLOQUEO`; 5d return (R-V13-add): `DEVOLUCION_FUERA_DE_PLAZO`, `CANTIDAD_EXCEDE_ORIGINAL`, `FACTURA_NO_VIGENTE`, `VENTA_NO_CONFIRMADA`. `STOCK_INSUFICIENTE` and `NCF_UMBRAL_90` remain **warning codes, never errors**. Every failure MUST carry stable code + user message + minimal context; stack traces/internal Prisma errors MUST NOT surface; DB states outside `EstadoVenta` MUST fail loud via the exhaustive `estadoVentaDesdeDb` mapping.
(Previously: 19 codes; no return error codes existed because returns were unimplemented.)

#### Scenario: Unknown stored state fails loud

- GIVEN a VENTA row holding a state value outside the enum mapping
- WHEN any load maps it
- THEN a typed runtime error occurs, never a silent coercion
- TEST: unit

#### Scenario: Exhausted range surfaces stable code

- GIVEN an empresa whose B02 sequence is exhausted
- WHEN confirm runs
- THEN `NCF_AGOTADA` returns as a typed business error with user message and no Prisma internals
- TEST: integration
