// Full-namespace import: `using Renju.Infrastructure.Model;` from a
// third project (Core). Skip=2 strips "Renju/Infrastructure", and the
// context-hint check must match "Renju.Infrastructure" against
// "Renju/Infrastructure" after dot-normalization.
using Renju.Infrastructure.Model;

namespace Core
{
    public class ServiceFull
    {
        public void Run()
        {
            var e = new RenjuEntity();
            e.GetId();
        }
    }
}
