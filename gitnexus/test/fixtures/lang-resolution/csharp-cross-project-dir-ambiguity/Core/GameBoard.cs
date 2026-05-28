// Importer in a THIRD project (Core) that uses a shortened namespace.
// `using Infrastructure.Model;` must resolve via the skip-loop context
// hint: the stripped prefix "Infrastructure" aligns with the path before
// /Model/ in "Infrastructure/Model/Entity.cs", not in
// "Infrastructure.Tests/Model/EntityTest.cs".
using Infrastructure.Model;

namespace Core
{
    public class GameBoard
    {
        public void Setup()
        {
            var e = new Entity();
            e.GetId();
        }
    }
}
