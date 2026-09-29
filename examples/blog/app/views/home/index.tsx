export default function HomeIndex(props: { framework: string }) {
  return (
    <section class="hero">
      <h1>Hello from {props.framework}</h1>
      <p>
        Edite <code>app/views/home/index.tsx</code> e recarregue a página. As rotas ficam em{" "}
        <code>config/routes.ts</code>.
      </p>
    </section>
  )
}
